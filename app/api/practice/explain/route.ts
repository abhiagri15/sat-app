import { NextResponse } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';
import { explainForUser } from '@/app/lib/practice/generation';
import type { ExplainInput } from '@/app/lib/ai/provider';
import { figureSchema, describeFigure } from '@/app/lib/ai/figure-schema';
import type { SectionKey } from '@/app/lib/questions';

// Session-authed POST route: "Explain my mistake" (design spec §E). NOT in
// middleware PUBLIC_PATHS — session-gated + re-checked in-route with getUser()
// (the generation module performs service-role writes, and coach_explains is a
// per-user rate-cap trail). Same shape as the three /api/practice/{lesson,
// guidance,topup} routes (#14).
export const dynamic = 'force-dynamic';
// The Ollama call runs 30–60s; match the generate-questions route budget.
export const maxDuration = 300;

// One live sat.questions row (snake_case; choices + figure arrive as jsonb).
// Read via the USER's client so RLS's select policy applies.
interface QuestionRow {
  section: string;
  skill: string;
  passage: string | null;
  prompt: string;
  choices: unknown;
  answer_index: number;
  response_format: string | null;
  correct_answer: string | null;
  figure: unknown;
}

// The client-supplied fallback snapshot for a review item whose sat.questions
// row may be gone (disabled/deleted). Used ONLY when the live re-read misses;
// the prompt marks it untrusted.
interface Snapshot {
  prompt: string;
  passage?: string | null;
  choices?: unknown;
  answerIndex?: number | null;
  correctAnswer?: string | null;
  responseFormat?: string | null;
  skill?: string | null;
  section?: string | null;
}

const QUESTION_COLUMNS =
  'section, skill, passage, prompt, choices, answer_index, response_format, correct_answer, figure';

// Coerce a jsonb value (unknown from supabase-js / the snapshot) into a
// string[] safely.
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v : String(v ?? '')));
}

// Deterministic plain-text figure serialization for the prompt, or undefined
// when the row/snapshot carries no valid figure (FigureView-style safety wall:
// a malformed figure degrades to no figure text, never an error).
function figureTextFrom(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const parsed = figureSchema.safeParse(raw);
  return parsed.success ? describeFigure(parsed.data) : undefined;
}

export async function POST(request: Request) {
  // Parse the body defensively — garbage in → 400.
  let questionId: unknown;
  let chosen: unknown;
  let entered: unknown;
  let snapshot: Snapshot | undefined;
  try {
    const body = (await request.json()) as {
      questionId?: unknown;
      chosen?: unknown;
      entered?: unknown;
      snapshot?: unknown;
    };
    questionId = body?.questionId;
    chosen = body?.chosen;
    entered = body?.entered;
    if (body?.snapshot && typeof body.snapshot === 'object') {
      snapshot = body.snapshot as Snapshot;
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  if (typeof questionId !== 'string' || questionId.length === 0) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  const chosenIndex = typeof chosen === 'number' ? chosen : null;
  const enteredValue = typeof entered === 'string' ? entered : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  // RE-READ the question by id via the USER's client first (RLS select applies).
  // A found LIVE row is trusted; a miss falls back to the client snapshot.
  const rowRes = await supabase
    .schema('sat')
    .from('questions')
    .select(QUESTION_COLUMNS)
    .eq('id', questionId)
    .maybeSingle();
  if (rowRes.error) {
    console.error('[practice] explain question read failed:', rowRes.error);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
  const row = rowRes.data as unknown as QuestionRow | null;

  // Build the ExplainInput from the live row (trusted) or the snapshot
  // (untrusted). Return 400 if neither yields usable question text.
  let input: (ExplainInput & { questionId: string }) | null = null;

  if (row) {
    const section: SectionKey = row.section === 'math' ? 'math' : 'rw';
    const responseFormat: 'mcq' | 'spr' = row.response_format === 'spr' ? 'spr' : 'mcq';
    const choices = toStringArray(row.choices);
    const correctText =
      responseFormat === 'spr'
        ? row.correct_answer ?? ''
        : choices[row.answer_index] ?? '';
    const chosenText =
      responseFormat === 'spr'
        ? enteredValue ?? ''
        : chosenIndex != null
        ? choices[chosenIndex] ?? ''
        : '';
    input = {
      questionId,
      section,
      skill: row.skill,
      prompt: row.prompt,
      passage: row.passage ?? undefined,
      choices,
      correctText,
      chosenText,
      enteredValue: responseFormat === 'spr' ? enteredValue ?? undefined : undefined,
      responseFormat,
      figureText: figureTextFrom(row.figure),
      trusted: true,
    };
  } else if (snapshot && typeof snapshot.prompt === 'string' && snapshot.prompt.length > 0) {
    const section: SectionKey = snapshot.section === 'math' ? 'math' : 'rw';
    const responseFormat: 'mcq' | 'spr' =
      snapshot.responseFormat === 'spr' ? 'spr' : 'mcq';
    const choices = toStringArray(snapshot.choices);
    const answerIndex =
      typeof snapshot.answerIndex === 'number' ? snapshot.answerIndex : null;
    const correctText =
      responseFormat === 'spr'
        ? snapshot.correctAnswer ?? ''
        : answerIndex != null
        ? choices[answerIndex] ?? ''
        : '';
    const chosenText =
      responseFormat === 'spr'
        ? enteredValue ?? ''
        : chosenIndex != null
        ? choices[chosenIndex] ?? ''
        : '';
    input = {
      questionId,
      section,
      skill: typeof snapshot.skill === 'string' ? snapshot.skill : '',
      prompt: snapshot.prompt,
      passage: typeof snapshot.passage === 'string' ? snapshot.passage : undefined,
      choices,
      correctText,
      chosenText,
      enteredValue: responseFormat === 'spr' ? enteredValue ?? undefined : undefined,
      responseFormat,
      // Snapshot carries no figure spec — it is display-only on the client.
      figureText: undefined,
      trusted: false,
    };
  }

  if (!input) {
    return NextResponse.json({ ok: false, error: 'question_not_found' }, { status: 404 });
  }

  const result = await explainForUser(user.id, input);
  if (result.status === 'capped') {
    return NextResponse.json({ ok: false, status: 'capped' }, { status: 429 });
  }
  if (result.status === 'failed') {
    return NextResponse.json({ ok: false, status: 'failed' }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    explanation: result.explanation,
    takeaway: result.takeaway,
  });
}
