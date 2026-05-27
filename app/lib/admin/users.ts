import { createClient } from '@/app/lib/supabase/server';
import { createAdminClient } from '@/app/lib/supabase/admin';
import type {
  AnalyticsSummary,
  AnalyticsView,
  SectionStat,
  SkillStat,
  TrendPoint,
} from '@/app/lib/analytics/compute';
import {
  PAGE_SIZE,
  joinedToDays,
  scoreBandToRange,
  type UsersSearchParams,
} from '@/app/lib/admin/users-search';

export interface AdminUserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'student' | 'admin';
  created_at: string;
}

// `avg_scaled_score` and `last_activity` are null when the user has no
// submitted attempts.
export interface AdminUserRow extends AdminUserProfile {
  tests_taken: number;
  avg_scaled_score: number | null;
  last_activity: string | null;
}

export interface UsersSearchResult {
  rows: AdminUserRow[];
  total: number;
}

export interface UsersStats {
  total: number;
  students: number;
  admins: number;
  active: number;
  active_7d: number;
}

// Defense in depth: the layout's requireAdmin() is the first gate; the RPC
// re-checks role = 'admin' inside and raises 'not authorized' otherwise.
// Substring search uses ILIKE on lower(full_name) and lower(email); users
// with a null email are silently excluded when a search term is present,
// which is intentional (display falls back to full_name).
export async function searchUsers(
  params: UsersSearchParams,
): Promise<UsersSearchResult> {
  const supabase = await createClient();
  const { min: scoreMin, max: scoreMax } = scoreBandToRange(params.score);
  const joinedDays = joinedToDays(params.joined);
  const { data, error } = await supabase
    .schema('sat')
    .rpc('admin_users_search', {
      p_q:           params.q,
      p_role:        params.role,
      p_activity:    params.activity,
      p_joined_days: joinedDays,
      p_score_min:   scoreMin,
      p_score_max:   scoreMax,
      p_sort:        params.sort,
      p_dir:         params.dir,
      p_offset:      (params.page - 1) * PAGE_SIZE,
      p_limit:       PAGE_SIZE,
    });
  if (error) {
    console.error('[searchUsers] failed:', error);
    return { rows: [], total: 0 };
  }
  const rows = (data ?? []) as unknown as Array<
    AdminUserRow & { total_count: number | string }
  >;
  const total = rows.length === 0 ? 0 : Number(rows[0].total_count);
  const stripped: AdminUserRow[] = rows.map((r) => ({
    id:               r.id,
    email:            r.email,
    full_name:        r.full_name,
    role:             r.role,
    created_at:       r.created_at,
    tests_taken:      r.tests_taken,
    avg_scaled_score: r.avg_scaled_score,
    last_activity:    r.last_activity,
  }));
  return { rows: stripped, total };
}

// Filter-independent on purpose, so the strip does not change as the user
// types in the search box.
export async function getUsersStats(): Promise<UsersStats> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('admin_users_stats');
  const empty: UsersStats = {
    total: 0, students: 0, admins: 0, active: 0, active_7d: 0,
  };
  if (error) {
    console.error('[getUsersStats] failed:', error);
    return empty;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return empty;
  return {
    total:     Number(row.total ?? 0),
    students:  Number(row.students ?? 0),
    admins:    Number(row.admins ?? 0),
    active:    Number(row.active ?? 0),
    active_7d: Number(row.active_7d ?? 0),
  };
}

// One user's profile by id. Uses the service-role client to bypass RLS on
// sat.profiles (whose select policy is scoped to auth.uid()). The /admin
// layout's requireAdmin() already gates this path. Returns null when the
// user does not exist (the page should notFound() on that).
export async function getUserProfileForAdmin(
  id: string,
): Promise<AdminUserProfile | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema('sat')
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[getUserProfileForAdmin] failed:', error);
    return null;
  }
  return (data ?? null) as AdminUserProfile | null;
}

interface AdminUserAnalyticsRpc {
  skills: SkillStat[];
  sections: SectionStat[];
  trend: TrendPoint[];
}

// Analytics view for a specific user, assembled from the admin_user_analytics
// RPC. The RPC returns sections, skills, and the score trend in one call; the
// summary stats are computed here from the trend's scaled scores plus the
// per-skill totals (questions answered). Mirrors getAnalytics()'s shape so
// the existing ScoreTrend / SkillAccuracy components can render it as-is.
export async function getUserAnalyticsForAdmin(
  userId: string,
): Promise<AnalyticsView> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('admin_user_analytics', { p_user_id: userId });

  const empty: AnalyticsView = {
    summary: { testsTaken: 0, bestScore: 0, averageScore: 0, questionsAnswered: 0 },
    sections: [],
    skills: [],
    trend: [],
  };
  if (error) {
    console.error('[getUserAnalyticsForAdmin] failed:', error);
    return empty;
  }
  if (!data) return empty;

  const rpc = data as AdminUserAnalyticsRpc;
  const skills = rpc.skills ?? [];
  const sections = rpc.sections ?? [];
  const trend = rpc.trend ?? [];

  return {
    summary: summarizeFromTrend(trend, skills),
    sections,
    skills,
    trend,
  };
}

function summarizeFromTrend(
  trend: TrendPoint[],
  skills: SkillStat[],
): AnalyticsSummary {
  const scores = trend.map((t) => t.score);
  const testsTaken = trend.length;
  const bestScore = testsTaken === 0 ? 0 : Math.max(...scores);
  const averageScore =
    testsTaken === 0
      ? 0
      : Math.round(scores.reduce((s, n) => s + n, 0) / testsTaken);
  const questionsAnswered = skills.reduce((s, k) => s + k.total, 0);
  return { testsTaken, bestScore, averageScore, questionsAnswered };
}
