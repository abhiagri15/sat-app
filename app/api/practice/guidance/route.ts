import { NextResponse } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';
import { SKILLS } from '@/app/lib/questions';
import { regenerateGuidance, EVIDENCE_LIMIT } from '@/app/lib/practice/generation';
import type { GuidanceEvidenceItem } from '@/app/lib/ai/provider';

// Session-authed POST route: refresh a student's per-skill "Coach's update"
// when it is stale. NOT in middleware PUBLIC_PATHS — session-gated + re-checked
// in-route (the generation module performs service-role writes).
export const dynamic = 'force-dynamic';
// Ollama generation runs 30–60s; match the generate-questions route budget.
export const maxDuration = 300;

// One row of the sat.skill_evidence RPC (snake_case; choices arrives as jsonb).
interface SkillEvidenceRow {
  prompt: string;
  choices: unknown;
  chosen_index: number | null;
  entered_value: string | null;
  correct_answer: string | null;
  answer_index: number | null;
  is_correct: boolean;
  response_format: string;
  difficulty: string | null;
  answered_at: string;
  origin: string;
}

// Coerce a jsonb value (unknown from supabase-js) into a string[] safely.
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v : String(v ?? '')));
}

export async function POST(request: Request) {
  // Parse the body defensively — garbage in → 400.
  let skill: unknown;
  try {
    const body = await request.json();
    skill = (body as { skill?: unknown })?.skill;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  if (typeof skill !== 'string' || skill.length === 0) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  const section = (['rw', 'math'] as const).find((s) => SKILLS[s].includes(skill));
  if (!section) {
    return NextResponse.json({ ok: false, error: 'unknown_skill' }, { status: 404 });
  }

  // Staleness re-check server-side, using the USER's client (RLS scopes it).
  // 1. Newest response timestamp for this user+skill.
  const latestRes = await supabase
    .schema('sat')
    .rpc('skill_latest_response', { p_skill: skill });
  if (latestRes.error) {
    console.error('[practice] guidance skill_latest_response failed:', latestRes.error);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
  const latest = latestRes.data as string | null;
  // No responses in this skill → nothing to coach on.
  if (!latest) {
    return NextResponse.json({ ok: true, status: 'fresh' });
  }

  // 2. Own guidance row (RLS scopes it to this user). If it already reflects
  //    the latest response, it is fresh — no regeneration.
  const guidanceRow = await supabase
    .schema('sat')
    .from('skill_guidance')
    .select('based_on_latest')
    .eq('skill', skill)
    .maybeSingle();
  if (guidanceRow.error) {
    console.error('[practice] guidance row read failed:', guidanceRow.error);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
  if (guidanceRow.data) {
    const basedOn = guidanceRow.data.based_on_latest as string;
    if (new Date(basedOn).getTime() >= new Date(latest).getTime()) {
      return NextResponse.json({ ok: true, status: 'fresh' });
    }
  }

  // 3. Gather evidence (user client; RLS scopes it).
  const evidenceRes = await supabase
    .schema('sat')
    .rpc('skill_evidence', { p_skill: skill, p_limit: EVIDENCE_LIMIT });
  if (evidenceRes.error) {
    console.error('[practice] guidance skill_evidence failed:', evidenceRes.error);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
  const rows = (evidenceRes.data ?? []) as unknown as SkillEvidenceRow[];

  // Map RPC rows → the GuidanceEvidenceItem shape the provider prompt expects.
  const evidence: GuidanceEvidenceItem[] = rows.map((r) => {
    const format: 'mcq' | 'spr' = r.response_format === 'spr' ? 'spr' : 'mcq';
    let chosen: string;
    let correct: string;
    if (format === 'mcq') {
      const choices = toStringArray(r.choices);
      chosen =
        r.chosen_index != null ? choices[r.chosen_index] ?? '(no answer)' : '(no answer)';
      correct = r.answer_index != null ? choices[r.answer_index] ?? '' : '';
    } else {
      chosen = r.entered_value ?? '(no answer)';
      correct = r.correct_answer ?? '';
    }
    return {
      prompt: r.prompt.slice(0, 200),
      chosen,
      correct,
      isCorrect: r.is_correct,
      difficulty: r.difficulty, // passthrough (may be null)
      format,
    };
  });

  // Accuracy over all evidence rows; last-10 over the 10 newest (rows are
  // newest-first from the RPC). last10Pct is null when fewer than 10 rows.
  const total = evidence.length;
  const correctCount = evidence.filter((e) => e.isCorrect).length;
  const accuracyPct = total === 0 ? 0 : Math.round((correctCount / total) * 100);
  let last10Pct: number | null = null;
  if (total >= 10) {
    const last10 = evidence.slice(0, 10);
    const last10Correct = last10.filter((e) => e.isCorrect).length;
    last10Pct = Math.round((last10Correct / 10) * 100);
  }

  const { status } = await regenerateGuidance(
    user.id,
    section,
    skill,
    evidence,
    accuracyPct,
    last10Pct,
    latest,
  );

  if (status === 'failed') {
    return NextResponse.json({ ok: false, status: 'failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status });
}
