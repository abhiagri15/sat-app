import { createClient } from '@/app/lib/supabase/server';
import { createAdminClient } from '@/app/lib/supabase/admin';
import type {
  AnalyticsSummary,
  AnalyticsView,
  SectionStat,
  SkillStat,
  TrendPoint,
} from '@/app/lib/analytics/compute';

// Just the profile fields, used by the detail page header.
export interface AdminUserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'student' | 'admin';
  created_at: string;
}

// One row in the admin users list — profile + aggregated stats.
// `avg_scaled_score` and `last_activity` are null when the user has no
// submitted attempts.
export interface AdminUserRow extends AdminUserProfile {
  tests_taken: number;
  avg_scaled_score: number | null;
  last_activity: string | null;
}

// Lists all users with per-user attempt counts, average score, and last
// activity. Calls the security-definer admin_users_summary RPC, which
// re-checks the caller is an admin before returning anything. The /admin
// layout's requireAdmin() is the first gate; this RPC is the second.
export async function listUsersWithStats(): Promise<AdminUserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('admin_users_summary');
  if (error) {
    console.error('[listUsersWithStats] failed:', error);
    return [];
  }
  return (data ?? []) as unknown as AdminUserRow[];
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

// Same shape as analytics/compute.ts#summarize but reads scores from the
// trend (which is what the admin RPC returns) instead of an AttemptSummary[].
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
