import { createClient } from '@/app/lib/supabase/server';
// Single source of truth (client-safe module) — the 'use client' test hook
// falls back to the same constant via questions.ts, which never imports this
// server-only file.
import { DEFAULT_MODULE2_THRESHOLD_PCT } from '@/app/lib/questions';

const DEFAULT_DAILY_ATTEMPT_LIMIT = 5;
// Default minimum count of never-served (globally fresh) questions per
// (section, skill, difficulty) cell. The question-generator (both the n8n
// workflow and the Vercel cron) fires whenever any cell drops below this
// floor. Admins can override it from /admin/pool.
const DEFAULT_NEVER_SERVED_FLOOR = 5;

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

// The app-wide AI kill switch (sat.app_config.ai_enabled). Read for the admin
// settings toggle's default state ONLY — this is a display read, so an
// unreadable value defaults to true (the column default) for rendering.
// NOTE: the actual spend gate, aiIsEnabled in app/lib/ai/kill-switch.ts,
// deliberately FAILS CLOSED instead — do not "align" it with this read.
export async function getAiEnabled(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('app_config')
    .select('ai_enabled')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) {
    console.error('[getAiEnabled] failed:', error);
    return true;
  }
  return (data as { ai_enabled: boolean | null }).ai_enabled !== false;
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

// Sub-project #11 follow-up (never-served floor admin control): minimum
// never-served-question count per (section, skill, difficulty) cell that
// the generator targets. The n8n workflow reads this through the
// sat.generator_state() RPC; the Vercel cron reads it via this function.
export async function getNeverServedFloor(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('app_config')
    .select('never_served_floor')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) {
    console.error('[getNeverServedFloor] failed:', error);
    return DEFAULT_NEVER_SERVED_FLOOR;
  }
  return (data as { never_served_floor: number }).never_served_floor;
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
