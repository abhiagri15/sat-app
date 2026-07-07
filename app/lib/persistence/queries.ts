import { createClient } from '@/app/lib/supabase/server';
import type { Question } from '@/app/lib/questions';
import { figureSchema } from '@/app/lib/ai/figure-schema';

export interface SectionBreakdownEntry {
  name: string;
  sectionKey: 'rw' | 'math';
  correct: number;
  total: number;
  scaled: number;
  module2Path?: 'easier' | 'harder' | null;   // null/omitted for short tests
}

// A test_attempts row, as listed on /dashboard.
export interface AttemptSummary {
  id: string;
  created_at: string;
  student_name: string;
  test_length: 'short' | 'full';
  total_correct: number;
  total_questions: number;
  scaled_score: number;
  section_breakdown: SectionBreakdownEntry[];
  breaks_used: boolean;
}

const SUMMARY_COLUMNS =
  'id, created_at, student_name, test_length, total_correct, total_questions, scaled_score, section_breakdown, breaks_used';

// The signed-in user's attempts, newest first. RLS scopes the rows to them.
// The id tie-break keeps the order stable for attempts saved in the same ms.
export async function listAttempts(): Promise<AttemptSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('test_attempts')
    .select(SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) {
    console.error('[listAttempts] failed:', error);
    return [];
  }
  return (data ?? []) as unknown as AttemptSummary[];
}

// One attempt_responses row, as stored.
export interface AttemptResponseRow {
  id: string;
  section_key: 'rw' | 'math';
  section_name: string;
  position: number;
  question_id: string;
  skill: string;
  source: 'seed' | 'ai';
  passage: string | null;
  prompt: string;
  choices: unknown;          // jsonb — guarded to string[] in responseToQuestion
  answer_index: number;
  explanation: string;
  chosen_index: number | null;
  is_correct: boolean;
  // SPR snapshot fields. Null/empty for mcq rows.
  response_format: 'mcq' | 'spr';
  entered_value: string | null;
  correct_answer: string | null;
  answer_tolerance: number | null;
  // Sub-project #11: which module (0 = Module 1, 1 = Module 2). Null for short attempts.
  module_index: number | null;
  // Sub-project #15: figure snapshot as presented (jsonb). Null for no figure.
  figure: unknown | null;
  // Sub-project #15: per-question active-display ms. Null for old rows / untimed.
  // Display-only — never feeds scoring.
  time_ms: number | null;
  // Sub-project #18: the student's own read of why they missed. Null for old
  // rows / untagged / correct rows. One of the MISS_REASONS values.
  miss_reason: string | null;
}

export interface AttemptDetail {
  attempt: AttemptSummary;
  responses: AttemptResponseRow[];
}

const RESPONSE_COLUMNS =
  'id, section_key, section_name, position, question_id, skill, source, passage, prompt, choices, answer_index, explanation, chosen_index, is_correct, response_format, entered_value, correct_answer, answer_tolerance, module_index, figure, time_ms, miss_reason';

// One attempt with all its responses, or null if it does not exist / is not
// the caller's (RLS) / the id is not a valid uuid (a malformed id makes the
// first query error — caught and treated as not-found).
export async function getAttempt(id: string): Promise<AttemptDetail | null> {
  const supabase = await createClient();

  const { data: attempt, error: attemptError } = await supabase
    .schema('sat')
    .from('test_attempts')
    .select(SUMMARY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (attemptError || !attempt) return null;

  const { data: responses, error: responsesError } = await supabase
    .schema('sat')
    .from('attempt_responses')
    .select(RESPONSE_COLUMNS)
    .eq('attempt_id', id)
    .order('position', { ascending: true });
  if (responsesError) return null;

  return {
    attempt: attempt as unknown as AttemptSummary,
    responses: (responses ?? []) as unknown as AttemptResponseRow[],
  };
}

// Reconstructs the Question shape ReviewItem expects from a stored response.
export function responseToQuestion(row: AttemptResponseRow): Question {
  const parsedFigure =
    row.figure != null ? figureSchema.safeParse(row.figure) : null;
  return {
    id: row.question_id,
    section: row.section_key,
    skill: row.skill,
    passage: row.passage ?? undefined,
    prompt: row.prompt,
    // `choices` is jsonb — guard a malformed value, matching rowToQuestion.
    choices: Array.isArray(row.choices) ? (row.choices as string[]) : [],
    answerIndex: row.answer_index,
    explanation: row.explanation,
    source: row.source,
    response_format: row.response_format === 'spr' ? 'spr' : 'mcq',
    correct_answer: row.correct_answer,
    answer_tolerance: row.answer_tolerance,
    // Sub-project #15: reviews render the figure snapshot AS PRESENTED (never a
    // re-join to the live question). Validate through figureSchema — the safety
    // wall — so a malformed snapshot degrades to null rather than crashing.
    figure: parsedFigure?.success ? parsedFigure.data : null,
  };
}
