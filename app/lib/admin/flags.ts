import { createAdminClient } from '@/app/lib/supabase/admin';

export type FlagStatus = 'open' | 'resolved';

export interface QuestionFlag {
  id: string;
  question_id: string;
  reason: string;
  comment: string | null;
  status: FlagStatus;
  created_at: string;
  question_prompt: string;
  question_section: string;
  question_enabled: boolean;
}

interface FlagRowRaw {
  id: string;
  question_id: string;
  reason: string;
  comment: string | null;
  status: FlagStatus;
  created_at: string;
}

interface QuestionLite {
  id: string;
  prompt: string;
  section: string;
  enabled: boolean;
}

// Admin-only. question_flags has no RLS policy, so reads go through the
// service-role client. Flags first, then the referenced questions, merged in JS.
export async function listFlags(
  status: FlagStatus | 'all',
): Promise<QuestionFlag[]> {
  const admin = createAdminClient();
  let query = admin
    .schema('sat')
    .from('question_flags')
    .select('id, question_id, reason, comment, status, created_at');
  if (status !== 'all') query = query.eq('status', status);
  const { data: flags, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !flags) {
    console.error('[listFlags] failed:', error);
    return [];
  }
  const rows = flags as unknown as FlagRowRaw[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.question_id))];
  const { data: questions } = await admin
    .schema('sat')
    .from('questions')
    .select('id, prompt, section, enabled')
    .in('id', ids);
  const qmap = new Map(
    ((questions ?? []) as unknown as QuestionLite[]).map((q) => [q.id, q]),
  );

  return rows.map((r) => {
    const q = qmap.get(r.question_id);
    return {
      ...r,
      question_prompt: q?.prompt ?? '(question not found)',
      question_section: q?.section ?? '',
      question_enabled: q?.enabled ?? true,
    };
  });
}

// Count of open flags, for the /admin entry-point link.
export async function countOpenFlags(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .schema('sat')
    .from('question_flags')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');
  if (error) {
    console.error('[countOpenFlags] failed:', error);
    return 0;
  }
  return count ?? 0;
}
