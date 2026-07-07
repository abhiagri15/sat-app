// SERVER ONLY. This module performs service-role writes to the dynamic-practice
// tables (sat.skill_lessons, sat.skill_guidance, sat.practice_topups) on behalf
// of the three session-authed POST routes under app/api/practice/. It is the
// ONE new createAdminClient import site for sub-project #14 — see the AI
// sub-project gotchas in CLAUDE.md (the secret-leak scan's expected list).
// NEVER import this from a 'use client' module.

import { getProvider } from '@/app/lib/ai/provider';
import type { ExplainInput, GuidanceInput } from '@/app/lib/ai/provider';
import { lessonSchema } from '@/app/lib/ai/lesson-schema';
import { guidanceSchema } from '@/app/lib/ai/guidance-schema';
import { explanationSchema } from '@/app/lib/ai/explanation-schema';
import { generateBatchForSkill } from '@/app/lib/ai/generate';
import { parseSpr } from '@/app/lib/spr';
import { createAdminClient } from '@/app/lib/supabase/admin';
import type { SectionKey } from '@/app/lib/questions';

// --- Constants (single definition site; imported by the routes) -------------

// A student with fewer than this many unseen questions in a skill triggers a
// post-drill top-up. At or above → healthy, no-op.
export const TOPUP_THRESHOLD = 12;
// How many questions one top-up run generates for the skill (through the same
// quality gate as the cron generator).
export const TOPUP_BATCH = 5;
// Per-(user, skill) top-up cooldown, minutes. A best-effort cap enforced
// against sat.practice_topups timestamps (serverless has no memory).
export const TOPUP_COOLDOWN_MIN = 30;
// Per-(user, skill) guidance-regeneration cooldown, minutes.
export const GUIDANCE_COOLDOWN_MIN = 10;
// How many recent responses feed the guidance prompt as evidence.
export const EVIDENCE_LIMIT = 12;
// Max "Explain my mistake" calls per user per UTC day (design spec §E).
// Best-effort under concurrency (same posture as the top-up cooldown) — the
// count is read then a row is inserted, with no lock; a race can let two calls
// both pass at the boundary. The cost of exceeding by one is one wasted Ollama
// call, so no lock.
export const EXPLAIN_DAILY_CAP = 30;

// The model identifier stored alongside generated content — mirrors however the
// Ollama provider names its model (process.env.SAT_AI_MODEL, read inside
// ollama.ts's chat()). Falls back to a sentinel if unset so a row is never
// written with a null/empty model (the columns are NOT NULL).
const MODEL = process.env.SAT_AI_MODEL ?? 'unknown';

// --- ensureBaseLesson -------------------------------------------------------

export type EnsureBaseLessonResult =
  | { status: 'exists' }
  | { status: 'generated' }
  | { status: 'failed' };

// Ensure an AI base lesson exists for (section, skill). Never throws.
//   - Row already present → { status: 'exists' } (no generation).
//   - Otherwise generate → lessonSchema.safeParse (+ a parseSpr guard on a
//     choiceless worked example; + force content.skill = skill, overwriting
//     whatever the model tagged) → one retry on any failure → insert with
//     `on conflict (skill) do nothing` (a lost race wastes one generation,
//     corrupts nothing) → { status: 'generated' } | { status: 'failed' }.
export async function ensureBaseLesson(
  section: SectionKey,
  skill: string,
): Promise<EnsureBaseLessonResult> {
  try {
    const admin = createAdminClient();

    // Already cached? (pk lookup)
    const existing = await admin
      .schema('sat')
      .from('skill_lessons')
      .select('skill')
      .eq('skill', skill)
      .maybeSingle();
    if (existing.error) {
      console.error('[practice-gen] ensureBaseLesson select failed', existing.error);
      return { status: 'failed' };
    }
    if (existing.data) return { status: 'exists' };

    const provider = getProvider();

    // One generate + one retry on any failure (bad JSON, schema miss, SPR
    // guard). Bad content never lands — if both attempts fail, nothing is
    // stored and the static fallback keeps serving.
    for (let attempt = 0; attempt < 2; attempt++) {
      let content: unknown;
      try {
        content = await provider.generateLesson(section, skill);
      } catch (e) {
        console.error('[practice-gen] ensureBaseLesson generate error', e);
        continue;
      }
      const parsed = lessonSchema.safeParse(content);
      if (!parsed.success) continue;
      const lesson = parsed.data;
      // Extra guard beyond pure zod: a choiceless (grid-in) worked example's
      // `correct` must be a valid SPR answer.
      if (
        lesson.workedExample.choices === undefined &&
        parseSpr(lesson.workedExample.correct) === null
      ) {
        continue;
      }
      // Force the skill field to the requested skill — do not trust the model
      // to have echoed it exactly.
      lesson.skill = skill;

      // insert ... on conflict (skill) do nothing — a concurrent generation
      // that landed first wins; supabase-js expresses do-nothing insert as
      // upsert with ignoreDuplicates. We treat the no-op as success (the
      // lesson now exists either way).
      const ins = await admin
        .schema('sat')
        .from('skill_lessons')
        .upsert(
          { skill, content: lesson, model: MODEL },
          { onConflict: 'skill', ignoreDuplicates: true },
        );
      if (ins.error) {
        console.error('[practice-gen] ensureBaseLesson insert failed', ins.error);
        continue;
      }
      return { status: 'generated' };
    }
    return { status: 'failed' };
  } catch (e) {
    console.error('[practice-gen] ensureBaseLesson unexpected error', e);
    return { status: 'failed' };
  }
}

// --- regenerateGuidance -----------------------------------------------------

export type RegenerateGuidanceResult =
  | { status: 'regenerated' }
  | { status: 'cooled_down' }
  | { status: 'failed' };

// Regenerate a per-student "Coach's update" for (user, skill). Never throws.
//   - Cooldown: if an existing row's generated_at is newer than
//     GUIDANCE_COOLDOWN_MIN minutes → { status: 'cooled_down' } (the previous
//     guidance keeps rendering; no regeneration).
//   - Otherwise generate → guidanceSchema.safeParse → one retry → upsert on
//     conflict (user_id, skill) with based_on_latest = latest →
//     { status: 'regenerated' } | { status: 'failed' }.
export async function regenerateGuidance(
  userId: string,
  section: SectionKey,
  skill: string,
  evidence: GuidanceInput['evidence'],
  accuracyPct: number,
  last10Pct: number | null,
  latest: string,
): Promise<RegenerateGuidanceResult> {
  try {
    const admin = createAdminClient();

    // Cooldown check against generated_at (pk lookup).
    const existing = await admin
      .schema('sat')
      .from('skill_guidance')
      .select('generated_at')
      .eq('user_id', userId)
      .eq('skill', skill)
      .maybeSingle();
    if (existing.error) {
      console.error('[practice-gen] regenerateGuidance select failed', existing.error);
      return { status: 'failed' };
    }
    if (existing.data) {
      const generatedAt = new Date(existing.data.generated_at as string).getTime();
      const ageMin = (Date.now() - generatedAt) / 60000;
      if (ageMin < GUIDANCE_COOLDOWN_MIN) return { status: 'cooled_down' };
    }

    const provider = getProvider();
    const input: GuidanceInput = {
      section,
      skill,
      accuracyPct,
      last10Pct,
      evidence,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      let content: unknown;
      try {
        content = await provider.generateGuidance(input);
      } catch (e) {
        console.error('[practice-gen] regenerateGuidance generate error', e);
        continue;
      }
      const parsed = guidanceSchema.safeParse(content);
      if (!parsed.success) continue;

      const up = await admin
        .schema('sat')
        .from('skill_guidance')
        .upsert(
          {
            user_id: userId,
            skill,
            content: parsed.data,
            model: MODEL,
            based_on_latest: latest,
            generated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,skill' },
        );
      if (up.error) {
        console.error('[practice-gen] regenerateGuidance upsert failed', up.error);
        continue;
      }
      return { status: 'regenerated' };
    }
    return { status: 'failed' };
  } catch (e) {
    console.error('[practice-gen] regenerateGuidance unexpected error', e);
    return { status: 'failed' };
  }
}

// --- topupSkill -------------------------------------------------------------

export type TopupSkillResult =
  | { status: 'generated'; inserted: number }
  | { status: 'skipped'; reason: 'healthy' | 'cooldown' }
  | { status: 'failed' };

// Post-drill targeted top-up for (user, skill). Never throws.
//   - unseenCount >= TOPUP_THRESHOLD → { status: 'skipped', reason: 'healthy' }.
//   - A sat.practice_topups row for (user, skill) newer than
//     TOPUP_COOLDOWN_MIN minutes → { status: 'skipped', reason: 'cooldown' }
//     (best-effort cap; two near-simultaneous saves can both pass — accepted,
//     dedup makes the rows converge).
//   - Otherwise generate TOPUP_BATCH questions through the SAME quality gate as
//     the cron generator (generateBatchForSkill), log the run, and return
//     { status: 'generated', inserted }.
export async function topupSkill(
  userId: string,
  section: SectionKey,
  skill: string,
  unseenCount: number,
): Promise<TopupSkillResult> {
  try {
    if (unseenCount >= TOPUP_THRESHOLD) {
      return { status: 'skipped', reason: 'healthy' };
    }

    const admin = createAdminClient();

    // Cooldown: latest top-up run for this (user, skill).
    const last = await admin
      .schema('sat')
      .from('practice_topups')
      .select('created_at')
      .eq('user_id', userId)
      .eq('skill', skill)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) {
      console.error('[practice-gen] topupSkill cooldown select failed', last.error);
      return { status: 'failed' };
    }
    if (last.data) {
      const createdAt = new Date(last.data.created_at as string).getTime();
      const ageMin = (Date.now() - createdAt) / 60000;
      if (ageMin < TOPUP_COOLDOWN_MIN) {
        return { status: 'skipped', reason: 'cooldown' };
      }
    }

    // Generate through the shared batch pipeline (default difficulty mix —
    // difficulty-targeted top-up is explicitly deferred). generateBatchForSkill
    // inserts survivors itself and never throws.
    const batch = await generateBatchForSkill(section, skill, TOPUP_BATCH);
    const inserted = batch.accepted;

    // Log the run (best-effort rate-cap trail). A logging failure must not mask
    // the fact that questions were inserted.
    const log = await admin
      .schema('sat')
      .from('practice_topups')
      .insert({ user_id: userId, skill, inserted });
    if (log.error) {
      console.error('[practice-gen] topupSkill log insert failed', log.error);
    }

    return { status: 'generated', inserted };
  } catch (e) {
    console.error('[practice-gen] topupSkill unexpected error', e);
    return { status: 'failed' };
  }
}

// --- explainForUser ---------------------------------------------------------

export type ExplainForUserResult =
  | { status: 'ok'; explanation: string; takeaway: string }
  | { status: 'capped' }
  | { status: 'failed' };

// "Explain my mistake" (design spec §E). Generate a per-question explanation of
// the student's specific wrong answer, rate-capped per user per UTC day. Never
// throws — the route degrades gracefully on any error.
//   - Count today's (UTC) sat.coach_explains rows for the user (service role).
//     At/over EXPLAIN_DAILY_CAP → { status: 'capped' } (no generation).
//   - Otherwise provider.explainMistake → explanationSchema.safeParse (one
//     retry on any failure) → insert the log row (user_id, question_id) →
//     { status: 'ok', ... }. A parse/generate failure after the retry →
//     { status: 'failed' }.
// The cap is best-effort under concurrency (see EXPLAIN_DAILY_CAP).
export async function explainForUser(
  userId: string,
  input: ExplainInput & { questionId: string },
): Promise<ExplainForUserResult> {
  try {
    const admin = createAdminClient();

    // UTC calendar-day window: [today 00:00Z, now]. head:exact count is a
    // single round trip that never pulls rows.
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const countRes = await admin
      .schema('sat')
      .from('coach_explains')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', dayStart.toISOString());
    if (countRes.error) {
      console.error('[practice-gen] explainForUser count failed', countRes.error);
      return { status: 'failed' };
    }
    if ((countRes.count ?? 0) >= EXPLAIN_DAILY_CAP) {
      return { status: 'capped' };
    }

    const provider = getProvider();
    // Strip the caller-only questionId before handing the LLM input to the
    // provider (the provider takes an ExplainInput, not the log key).
    const { questionId, ...llmInput } = input;

    for (let attempt = 0; attempt < 2; attempt++) {
      let content: unknown;
      try {
        content = await provider.explainMistake(llmInput);
      } catch (e) {
        console.error('[practice-gen] explainForUser generate error', e);
        continue;
      }
      const parsed = explanationSchema.safeParse(content);
      if (!parsed.success) continue;

      // Log the call (rate-cap trail). A logging failure must not mask a
      // successful explanation — the response is already valid.
      const log = await admin
        .schema('sat')
        .from('coach_explains')
        .insert({ user_id: userId, question_id: questionId });
      if (log.error) {
        console.error('[practice-gen] explainForUser log insert failed', log.error);
      }

      return {
        status: 'ok',
        explanation: parsed.data.explanation,
        takeaway: parsed.data.takeaway,
      };
    }
    return { status: 'failed' };
  } catch (e) {
    console.error('[practice-gen] explainForUser unexpected error', e);
    return { status: 'failed' };
  }
}
