import { createClient } from '@/app/lib/supabase/server';

const DEFAULT_DAILY_ATTEMPT_LIMIT = 5;

// The app-wide daily test-attempt limit per user (from sat.app_config).
// Falls back to the default if the config row is unreadable.
export async function getDailyAttemptLimit(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('app_config')
    .select('daily_attempt_limit')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) {
    console.error('[getDailyAttemptLimit] failed:', error);
    return DEFAULT_DAILY_ATTEMPT_LIMIT;
  }
  return (data as { daily_attempt_limit: number }).daily_attempt_limit;
}

export interface AttemptUsage {
  used: number; // tests submitted today (UTC) by the signed-in user
  limit: number; // the app-wide daily limit
  remaining: number; // max(0, limit - used)
  limitReached: boolean;
}

// Today's attempt usage for the signed-in user. The test_attempts RLS policy
// scopes the count to the caller; the date filter is the UTC calendar day.
export async function getAttemptUsage(): Promise<AttemptUsage> {
  const supabase = await createClient();
  const limit = await getDailyAttemptLimit();
  const todayUtc = new Date().toISOString().slice(0, 10);
  const { count, error } = await supabase
    .schema('sat')
    .from('test_attempts')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayUtc);
  if (error) {
    console.error('[getAttemptUsage] failed:', error);
    return { used: 0, limit, remaining: limit, limitReached: false };
  }
  const used = count ?? 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    limitReached: used >= limit,
  };
}
