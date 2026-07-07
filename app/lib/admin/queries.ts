import { createAdminClient } from '@/app/lib/supabase/admin';
import { createClient } from '@/app/lib/supabase/server';

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
  'id, section, skill, passage, prompt, choices, answer_index, explanation, source, enabled, created_at, difficulty, classified_at, figure';

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
