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
}

const QUESTION_COLUMNS =
  'id, section, skill, passage, prompt, choices, answer_index, explanation, source, enabled, created_at';

// The question pool, newest first, filtered, capped at 200 rows.
export async function listQuestions(
  filters: QuestionFilters,
): Promise<AdminQuestion[]> {
  const supabase = await createClient();
  let query = supabase.schema('sat').from('questions').select(QUESTION_COLUMNS);
  if (filters.section) query = query.eq('section', filters.section);
  if (filters.status === 'enabled') query = query.eq('enabled', true);
  if (filters.status === 'disabled') query = query.eq('enabled', false);
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

// Pool-wide counts for the /admin header. The pool is small — count in JS.
export async function getPoolCounts(): Promise<PoolCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('questions')
    .select('section, source, enabled');
  if (error || !data) {
    console.error('[getPoolCounts] failed:', error);
    return { total: 0, enabled: 0, disabled: 0, ai: 0, seed: 0, rw: 0, math: 0 };
  }
  const rows = data as { section: string; source: string; enabled: boolean }[];
  return {
    total: rows.length,
    enabled: rows.filter((r) => r.enabled).length,
    disabled: rows.filter((r) => !r.enabled).length,
    ai: rows.filter((r) => r.source === 'ai').length,
    seed: rows.filter((r) => r.source === 'seed').length,
    rw: rows.filter((r) => r.section === 'rw').length,
    math: rows.filter((r) => r.section === 'math').length,
  };
}
