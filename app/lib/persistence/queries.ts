import { createClient } from '@/app/lib/supabase/server';

export interface SectionBreakdownEntry {
  name: string;
  correct: number;
  total: number;
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
}

const SUMMARY_COLUMNS =
  'id, created_at, student_name, test_length, total_correct, total_questions, scaled_score, section_breakdown';

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
