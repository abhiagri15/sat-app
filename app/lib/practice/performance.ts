import { createClient } from '@/app/lib/supabase/server';
import { lessonSchema } from '@/app/lib/ai/lesson-schema';
import { guidanceSchema } from '@/app/lib/ai/guidance-schema';
import type { Lesson } from '@/app/lib/lessons/types';
import type { Guidance } from '@/app/lib/ai/guidance-schema';

// Server-only reads for the dynamic-practice skill page (see the Dynamic
// Practice spec §A/§B/§E). All reads go through the USER's Supabase client
// (RLS scopes them); this module never touches the service role. Every read is
// graceful — a failure logs and returns a null/neutral value so the page still
// renders (same discipline as app/lib/practice/queries.ts).

// The AI base lesson row for a skill, with its stored jsonb validated against
// lessonSchema. Invalid stored content is treated as if there were no row.
export interface SkillLessonRow {
  lesson: Lesson;
  generatedAt: string;
}

// Reads the AI base lesson for a skill from sat.skill_lessons (shared content;
// select-for-authenticated). Returns null when there is no row, on error, or
// when the stored jsonb fails lessonSchema (logs the invalid case). A null
// result means the page falls back to the static lesson.
export async function getSkillLessonRow(
  skill: string,
): Promise<SkillLessonRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('skill_lessons')
    .select('content, generated_at')
    .eq('skill', skill)
    .maybeSingle();
  if (error) {
    console.error('[practice] getSkillLessonRow failed:', error);
    return null;
  }
  if (!data) return null;
  const parsed = lessonSchema.safeParse(
    (data as { content: unknown }).content,
  );
  if (!parsed.success) {
    console.error(
      '[practice] getSkillLessonRow: stored lesson failed lessonSchema for skill',
      skill,
      parsed.error.issues,
    );
    return null;
  }
  return {
    lesson: parsed.data,
    generatedAt: (data as { generated_at: string }).generated_at,
  };
}

// The signed-in student's own "Coach's update" for a skill, validated.
export interface GuidanceRow {
  guidance: Guidance;
  generatedAt: string;
  basedOnLatest: string;
}

// Reads the signed-in student's own guidance row from sat.skill_guidance
// (select-own via RLS). Returns null when there is no row, on error, or when
// the stored jsonb fails guidanceSchema (logs the invalid case).
export async function getGuidance(skill: string): Promise<GuidanceRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('skill_guidance')
    .select('content, generated_at, based_on_latest')
    .eq('skill', skill)
    .maybeSingle();
  if (error) {
    console.error('[practice] getGuidance failed:', error);
    return null;
  }
  if (!data) return null;
  const parsed = guidanceSchema.safeParse(
    (data as { content: unknown }).content,
  );
  if (!parsed.success) {
    console.error(
      '[practice] getGuidance: stored guidance failed guidanceSchema for skill',
      skill,
      parsed.error.issues,
    );
    return null;
  }
  return {
    guidance: parsed.data,
    generatedAt: (data as { generated_at: string }).generated_at,
    basedOnLatest: (data as { based_on_latest: string }).based_on_latest,
  };
}

// Whether the student's guidance is stale relative to their latest response.
export interface GuidanceStaleness {
  // The student has ≥1 response in this skill AND (no guidance OR the newest
  // response is newer than the guidance's watermark).
  stale: boolean;
  // The student has answered at least one question in this skill.
  hasAnyResponse: boolean;
}

// Computes staleness by calling sat.skill_latest_response (security-invoker RPC:
// the max response timestamp for the signed-in user across attempt + practice
// responses for the skill; RLS scopes it). Given the existing guidance's
// based_on_latest watermark (null when there is no guidance row):
//   - no responses at all → { stale: false, hasAnyResponse: false }
//   - responses AND (no guidance OR latest > basedOnLatest) → stale: true
//   - responses AND guidance up to date → stale: false
// On error, returns { stale: false, hasAnyResponse: false } (graceful).
export async function getGuidanceStaleness(
  skill: string,
  existingBasedOnLatest: string | null,
): Promise<GuidanceStaleness> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('skill_latest_response', { p_skill: skill });
  if (error) {
    console.error('[practice] getGuidanceStaleness failed:', error);
    return { stale: false, hasAnyResponse: false };
  }
  const latest = data as string | null;
  if (!latest) {
    return { stale: false, hasAnyResponse: false };
  }
  const stale =
    existingBasedOnLatest === null ||
    new Date(latest).getTime() > new Date(existingBasedOnLatest).getTime();
  return { stale, hasAnyResponse: true };
}
