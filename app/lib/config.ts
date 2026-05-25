import { createClient } from '@/app/lib/supabase/server';

const DEFAULT_DAILY_ATTEMPT_LIMIT = 5;
const DEFAULT_MODULE2_THRESHOLD_PCT = 60;

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

// Sub-project #11: the Module 2 routing threshold (% of Module 1 correct
// required to take the harder Module 2) — now per-section. Reads from the
// single-row sat.app_config; falls back to the default if unreadable.
export async function getModule2ThresholdPct(
  section: 'rw' | 'math',
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('app_config')
    .select('rw_module2_threshold_pct, math_module2_threshold_pct')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) {
    console.error('[getModule2ThresholdPct] failed:', error);
    return DEFAULT_MODULE2_THRESHOLD_PCT;
  }
  const row = data as {
    rw_module2_threshold_pct: number;
    math_module2_threshold_pct: number;
  };
  return section === 'rw' ? row.rw_module2_threshold_pct : row.math_module2_threshold_pct;
}

// Sub-project #11 follow-up: read both Module 2 routing thresholds for
// the admin settings UI (the runtime path uses getModule2ThresholdPct per
// section). Fallback to defaults if unreadable.
export async function getModule2Thresholds(): Promise<{ rw: number; math: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('app_config')
    .select('rw_module2_threshold_pct, math_module2_threshold_pct')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) {
    console.error('[getModule2Thresholds] failed:', error);
    return { rw: DEFAULT_MODULE2_THRESHOLD_PCT, math: DEFAULT_MODULE2_THRESHOLD_PCT };
  }
  const row = data as {
    rw_module2_threshold_pct: number;
    math_module2_threshold_pct: number;
  };
  return { rw: row.rw_module2_threshold_pct, math: row.math_module2_threshold_pct };
}

// Sub-project #11 follow-up: per-user "hide path while testing" preference.
// Default false (path is shown). Read from sat.profiles for the signed-in user.
export async function getHideModule2Path(): Promise<boolean> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return false;
  const { data, error } = await supabase
    .schema('sat')
    .from('profiles')
    .select('hide_module2_path')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean((data as { hide_module2_path: boolean }).hide_module2_path);
}
