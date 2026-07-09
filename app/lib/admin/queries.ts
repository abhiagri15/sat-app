import { createAdminClient } from '@/app/lib/supabase/admin';
import { createClient } from '@/app/lib/supabase/server';
import { SKILLS } from '@/app/lib/questions';

export interface AdminQuestion {
  id: string;
  section: 'rw' | 'math';
  skill: string;
  passage: string | null;
  prompt: string;
  choices: unknown;
  answer_index: number;
  explanation: string;
  source: 'seed' | 'ai';
  enabled: boolean;
  created_at: string;
  difficulty: 'easy' | 'medium' | 'hard';      // Sub-project #11
  classified_at: string | null;                // Sub-project #11
  figure: unknown | null;                       // Sub-project #15: figure spec (jsonb)
  difficulty_source: 'model' | 'empirical';     // Sub-project #15: model-labeled vs empirically calibrated
  review_status: 'active' | 'approved' | 'needs_review'; // #19 Trust & Coverage: content-trust gate (orthogonal to enabled)
}

export interface PoolCounts {
  total: number;
  enabled: number;
  disabled: number;
  ai: number;
  seed: number;
  rw: number;
  math: number;
}

export interface QuestionFilters {
  section?: 'rw' | 'math';
  status?: 'enabled' | 'disabled';
  difficulty?: 'easy' | 'medium' | 'hard';
}

const QUESTION_COLUMNS =
  'id, section, skill, passage, prompt, choices, answer_index, explanation, source, enabled, created_at, difficulty, classified_at, figure, difficulty_source, review_status';

// The question pool, newest first, filtered, capped at 200 rows.
export async function listQuestions(
  filters: QuestionFilters,
): Promise<AdminQuestion[]> {
  const supabase = await createClient();
  let query = supabase.schema('sat').from('questions').select(QUESTION_COLUMNS);
  if (filters.section) query = query.eq('section', filters.section);
  if (filters.status === 'enabled') query = query.eq('enabled', true);
  if (filters.status === 'disabled') query = query.eq('enabled', false);
  if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[listQuestions] failed:', error);
    return [];
  }
  return (data ?? []) as unknown as AdminQuestion[];
}

// One question by id, or null if it does not exist.
export async function getQuestion(id: string): Promise<AdminQuestion | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('questions')
    .select(QUESTION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[getQuestion] failed:', error);
    return null;
  }
  if (!data) return null;
  return data as unknown as AdminQuestion;
}

// Same snapshot the question-generator uses to plan its next batches: the
// worst-off student's overall unseen count, the configured per-skill floor,
// the buffer target, and per-skill / per-cell worstStudentUnseen counts
// (the MIN across active students of that student's unseen count for the
// scope). The floor compares against worstStudentUnseen, so the generator
// replenishes a skill the moment ANY active student drops below floor for
// that skill.
//
// Powered by sat.generator_state() — a single RPC keeps the admin view in
// lockstep with what the n8n workflow sees on its next run.
//
// Skills/cells with no enabled questions don't appear in the arrays;
// consumers cross-product against the canonical SKILLS list and default
// missing entries to 0.
//
// Service-role client because generator_state() is security-definer and the
// pool composition is admin-only; this also matches how the n8n side calls
// it (via the service-role key). The page route is already requireAdmin()'d.
export interface GeneratorStateSkill {
  section: 'rw' | 'math';
  skill: string;
  worstStudentUnseen: number;
}

export interface GeneratorStateCell {
  section: 'rw' | 'math';
  skill: string;
  difficulty: 'easy' | 'medium' | 'hard';
  worstStudentUnseen: number;
}

export interface GeneratorState {
  minActiveUserUnseen: number | null;
  neverServedFloor: number;
  bufferTarget: number;
  skills: GeneratorStateSkill[];
  cells: GeneratorStateCell[];
}

export async function getGeneratorState(): Promise<GeneratorState> {
  const admin = createAdminClient();
  const { data, error } = await admin.schema('sat').rpc('generator_state');
  if (error || !data) {
    console.error('[getGeneratorState] failed:', error);
    return {
      minActiveUserUnseen: null,
      neverServedFloor: 5,
      bufferTarget: 100,
      skills: [],
      cells: [],
    };
  }
  // The RPC returns jsonb already shaped like GeneratorState.
  return data as unknown as GeneratorState;
}

// Pool-wide counts for the /admin header. Backed by the sat.admin_pool_counts()
// SQL aggregate (one round trip, exact at any pool size) — the same RPC pattern
// the public /how-it-works page uses (sat.public_pool_stats), but admin-scoped
// so it also carries total/disabled/ai/seed. The old version fetched every row
// and tallied in JS, which PostgREST capped at `max-rows` (1000), silently
// pinning Total at 1000 once the pool outgrew it.
export async function getPoolCounts(): Promise<PoolCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema('sat').rpc('admin_pool_counts');
  if (error || !data) {
    console.error('[getPoolCounts] failed:', error);
    return { total: 0, enabled: 0, disabled: 0, ai: 0, seed: 0, rw: 0, math: 0 };
  }
  return data as unknown as PoolCounts;
}

// Empirical item statistics for one question — the admin item-analysis surface
// (design spec §C). Aggregates real student performance across BOTH response
// tables (test attempts + practice drills) for this question_id:
//   - n:        total graded responses
//   - correct:  responses graded correct → p-value = correct / n (when n > 0)
//   - avgTimeMs: average active-display time over non-null time_ms samples only
//               (old rows / walked-away tabs contribute null and are excluded)
//   - openFlags: open sat.question_flags for this question
//
// Uses the service-role client — the response tables are RLS select-own
// (users see only their own rows) and question_flags is policy-less, so an
// admin item view must bypass RLS. This file already imports createAdminClient
// (getGeneratorState). The page route is requireAdmin()'d.
export interface QuestionItemStats {
  n: number;
  correct: number;
  avgTimeMs: number | null;
  openFlags: number;
}

// The admin needs-review queue (design spec §D) — one row per ENABLED question
// that is an item-quality anomaly: heavily flagged (open_flags >= 2), or, with
// >= 10 graded responses, pathologically hard (p < 0.15) or easy (p > 0.97).
// Ordered flags desc then n desc by the RPC.
//
// Backed by sat.admin_review_queue(p_limit) — security-definer, grant-execute
// to service_role ONLY, so it is called via the service-role client (students
// must never be able to enumerate item-quality anomalies). The page route is
// already requireAdmin()'d.
//
// The RPC returns bigints (n, open_flags) as strings over the wire — coerce via
// Number(). It returns only question_id; we fetch the prompts for the returned
// ids in one in() query on sat.questions (the listFlags precedent) and merge so
// the queue can show a prompt excerpt.
//
// Degrades gracefully: if the RPC errors (e.g. the migration is not applied
// yet), console.error and return an empty queue rather than throwing — an
// unmigrated environment shows "Nothing needs review", not a 500.
export type ReviewReason = 'flagged' | 'very-hard-suspect' | 'too-easy';

export interface ReviewQueueRow {
  question_id: string;
  section: 'rw' | 'math';
  skill: string;
  difficulty: 'easy' | 'medium' | 'hard';
  review_status: 'active' | 'approved' | 'needs_review';
  n: number;
  p_value: number | null;
  open_flags: number;
  reasons: ReviewReason[];
  prompt: string;
}

interface ReviewQueueRaw {
  question_id: string;
  section: 'rw' | 'math';
  skill: string;
  difficulty: 'easy' | 'medium' | 'hard';
  review_status: 'active' | 'approved' | 'needs_review';
  n: number | string;
  p_value: number | string | null;
  open_flags: number | string;
  reasons: string[] | null;
}

export async function getReviewQueue(limit = 50): Promise<ReviewQueueRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema('sat')
    .rpc('admin_review_queue', { p_limit: limit });
  if (error || !data) {
    console.error('[getReviewQueue] failed:', error);
    return [];
  }

  const raw = data as unknown as ReviewQueueRaw[];
  if (raw.length === 0) return [];

  // Fetch the prompts for the returned ids in one round trip and merge.
  const ids = [...new Set(raw.map((r) => r.question_id))];
  const { data: questions, error: qErr } = await admin
    .schema('sat')
    .from('questions')
    .select('id, prompt')
    .in('id', ids);
  if (qErr) console.error('[getReviewQueue] prompt fetch failed:', qErr);
  const prompts = new Map(
    ((questions ?? []) as unknown as { id: string; prompt: string }[]).map((q) => [
      q.id,
      q.prompt,
    ]),
  );

  return raw.map((r) => ({
    question_id: r.question_id,
    section: r.section,
    skill: r.skill,
    difficulty: r.difficulty,
    review_status: r.review_status,
    n: Number(r.n),
    p_value: r.p_value == null ? null : Number(r.p_value),
    open_flags: Number(r.open_flags),
    reasons: (r.reasons ?? []) as ReviewReason[],
    prompt: prompts.get(r.question_id) ?? '(question not found)',
  }));
}

// Admin Overview health card (design spec §C2 / T4). Two operational signals:
//   - saveFailures7d: how many attempt/practice saves failed in the last 7 days
//     (a spike means the save path is broken for real users). Counted via a
//     head:true exact-count query — NOT a JS row tally (the admin-count-maxrows
//     gotcha: PostgREST caps returned rows at max-rows, so tallying in JS
//     silently undercounts; count queries are exact at any size).
//   - lastRun: the most recent sat.generation_runs row (the daily cron). A row
//     whose completed_at is null = a killed run (maxDuration hit mid-batch) or
//     the generator_state throw path — exactly the signal the card surfaces.
//     summary fields are plucked null-safe (an old/partial row may lack them).
//
// Both tables are RLS-on, policy-less, service-role-only (the question_flags /
// save_failures posture), so this reads via the service-role client. The page
// route is already requireAdmin()'d. Degrades gracefully on error: log +
// zeros/null, never throws (matching this file's other reads).
export interface HealthSummary {
  saveFailures7d: number;
  lastRun: {
    startedAt: string;
    completedAt: string | null;
    accepted: number | null;
    calibrated: number | null;
    flaggedForReview: number | null;
    aiEnabled: boolean | null;
  } | null;
  // Pool-insert heartbeat. `lastRun` only reflects the daily Vercel cron (the
  // hourly n8n generator writes questions but no generation_runs row), so the
  // latest sat.questions insert is the signal that SOME generator is alive —
  // regardless of which path produced it.
  lastInsert: { at: string; insertedTodayUtc: number } | null;
  // Pool inventory, from the same sat.generator_state() snapshot the two
  // generators gate on. `thinSkills` lists the skills where the WORST-OFF
  // active student's unseen-enabled-question count is below the never-served
  // floor (the exact predicate of the generator's floor gate), thinnest
  // first — the early-warning that scored-test assembly is at risk if
  // generation pauses. minActiveUserUnseen null = no active students yet
  // (thinSkills is forced empty then: every skill would read 0 and the list
  // would be all noise). Null on RPC error (graceful, like the other reads).
  pool: {
    minActiveUserUnseen: number | null;
    bufferTarget: number;
    neverServedFloor: number;
    thinSkills: { section: 'rw' | 'math'; skill: string; worst: number }[];
  } | null;
}

export async function getHealthSummary(): Promise<HealthSummary> {
  const admin = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const todayUtcStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';

  const [failuresRes, runRes, latestInsertRes, todayCountRes, stateRes] =
    await Promise.all([
      admin
        .schema('sat')
        .from('save_failures')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', sevenDaysAgo),
      admin
        .schema('sat')
        .from('generation_runs')
        .select('started_at, completed_at, summary')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .schema('sat')
        .from('questions')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // head:true exact count — never tally rows in JS (admin-count-maxrows gotcha).
      admin
        .schema('sat')
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayUtcStart),
      // Same snapshot RPC the generators gate on (see generate.ts).
      admin.schema('sat').rpc('generator_state'),
    ]);

  if (failuresRes.error) {
    console.error('[getHealthSummary] save_failures count failed:', failuresRes.error);
  }
  if (runRes.error) {
    console.error('[getHealthSummary] generation_runs read failed:', runRes.error);
  }
  if (latestInsertRes.error) {
    console.error('[getHealthSummary] latest question read failed:', latestInsertRes.error);
  }
  if (todayCountRes.error) {
    console.error('[getHealthSummary] today insert count failed:', todayCountRes.error);
  }
  if (stateRes.error) {
    console.error('[getHealthSummary] generator_state read failed:', stateRes.error);
  }

  const row = runRes.error ? null : runRes.data;
  let lastRun: HealthSummary['lastRun'] = null;
  if (row) {
    const summary = (row.summary ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === 'number' ? v : null;
    lastRun = {
      startedAt: row.started_at as string,
      completedAt: (row.completed_at as string | null) ?? null,
      accepted: num(summary.accepted),
      calibrated: num(summary.calibrated),
      flaggedForReview: num(summary.flaggedForReview),
      aiEnabled:
        typeof summary.aiEnabled === 'boolean' ? summary.aiEnabled : null,
    };
  }

  const latestInsert = latestInsertRes.error ? null : latestInsertRes.data;
  const lastInsert = latestInsert
    ? {
        at: latestInsert.created_at as string,
        insertedTodayUtc: todayCountRes.error ? 0 : todayCountRes.count ?? 0,
      }
    : null;

  // Pool inventory: cross-product SKILLS against the per-skill worst-student
  // counts (missing entries mean that skill has no enabled questions → 0,
  // the generate.ts convention) and keep the below-floor ones, thinnest
  // first. Forced empty when there are no active students yet — every skill
  // would read 0 and the list would be meaningless.
  let pool: HealthSummary['pool'] = null;
  if (!stateRes.error && stateRes.data) {
    const state = stateRes.data as unknown as {
      minActiveUserUnseen: number | null;
      bufferTarget: number;
      neverServedFloor: number;
      skills: { section: 'rw' | 'math'; skill: string; worstStudentUnseen: number }[];
    };
    const skillWorst = new Map<string, number>();
    for (const s of state.skills ?? []) {
      skillWorst.set(`${s.section}|${s.skill}`, s.worstStudentUnseen);
    }
    const thinSkills: { section: 'rw' | 'math'; skill: string; worst: number }[] = [];
    if (state.minActiveUserUnseen !== null) {
      for (const section of ['rw', 'math'] as const) {
        for (const skill of SKILLS[section]) {
          const worst = skillWorst.get(`${section}|${skill}`) ?? 0;
          if (worst < state.neverServedFloor) {
            thinSkills.push({ section, skill, worst });
          }
        }
      }
      thinSkills.sort((a, b) => a.worst - b.worst);
    }
    pool = {
      minActiveUserUnseen: state.minActiveUserUnseen,
      bufferTarget: state.bufferTarget,
      neverServedFloor: state.neverServedFloor,
      thinSkills,
    };
  }

  return {
    saveFailures7d: failuresRes.error ? 0 : failuresRes.count ?? 0,
    lastRun,
    lastInsert,
    pool,
  };
}

export async function getQuestionItemStats(id: string): Promise<QuestionItemStats> {
  const admin = createAdminClient();

  // Pull the is_correct + time_ms columns from both response tables and fold
  // in JS — one round trip each, small per-question row counts, and it keeps
  // the null-only-average and correct-tally logic in one readable place.
  const [attemptRes, practiceRes, flagsRes] = await Promise.all([
    admin
      .schema('sat')
      .from('attempt_responses')
      .select('is_correct, time_ms')
      .eq('question_id', id),
    admin
      .schema('sat')
      .from('practice_responses')
      .select('is_correct, time_ms')
      .eq('question_id', id),
    admin
      .schema('sat')
      .from('question_flags')
      .select('id', { count: 'exact', head: true })
      .eq('question_id', id)
      .eq('status', 'open'),
  ]);

  if (attemptRes.error) console.error('[getQuestionItemStats] attempts failed:', attemptRes.error);
  if (practiceRes.error) console.error('[getQuestionItemStats] practice failed:', practiceRes.error);
  if (flagsRes.error) console.error('[getQuestionItemStats] flags failed:', flagsRes.error);

  const rows = [
    ...((attemptRes.data ?? []) as { is_correct: boolean; time_ms: number | null }[]),
    ...((practiceRes.data ?? []) as { is_correct: boolean; time_ms: number | null }[]),
  ];

  let correct = 0;
  let timeSum = 0;
  let timeCount = 0;
  for (const r of rows) {
    if (r.is_correct) correct++;
    if (r.time_ms != null) {
      timeSum += r.time_ms;
      timeCount++;
    }
  }

  return {
    n: rows.length,
    correct,
    avgTimeMs: timeCount > 0 ? Math.round(timeSum / timeCount) : null,
    openFlags: flagsRes.count ?? 0,
  };
}
