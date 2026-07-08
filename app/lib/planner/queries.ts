import { createClient } from '@/app/lib/supabase/server';
import { getAnalytics } from '@/app/lib/analytics/queries';
import { getPracticeSkillStats } from '@/app/lib/practice/queries';
import { listAttempts } from '@/app/lib/persistence/queries';
import { weekStartInTz } from './timezone';
import type { PlannerInputs, MissReasonMixRow } from './compute';

// Planner query layer (#18, Task 7). Assembles the pure-compute `PlannerInputs`
// object from the existing analytics / practice / attempt data sources plus the
// new planner-specific reads (the study-plan row and the miss-reason mix).
//
// GRACEFUL DEGRADATION is the standing rule here: the migration
// (20260707060000_sat_planner.sql) may not be applied yet, so EVERY new read
// (`study_plans` select, `miss_reason_mix` RPC) must degrade to null / [] on
// error rather than throw. The build gate is run with the RPCs missing.

// ---------------------------------------------------------------------------
// "This ISO week" boundary
// ---------------------------------------------------------------------------
//
// Monday 00:00 in the STUDENT's own IANA zone (T2, #19) — replaces the old
// server-local `isoWeekStart`. Vercel runs UTC, so a server-local (or plain UTC)
// Monday boundary flips the week over at an arbitrary local hour for a US
// student; `weekStartInTz` (app/lib/planner/timezone.ts) anchors the boundary to
// the zone captured on the plan row. Plan-less users keep UTC (their plan
// doesn't exist yet, so week accuracy is moot). See getPlannerInputs below.

// ---------------------------------------------------------------------------
// getStudyPlan — the user's own sat.study_plans row (RLS select-own), or null.
// ---------------------------------------------------------------------------

export interface StudyPlanRow {
  targetScore: number;
  testDate: string | null;
  sessionsPerWeek: number;
  timezone: string | null;
}

// Reads the signed-in user's plan row via the user client (RLS confines it).
// Returns null on a missing row OR any error (table not yet migrated) — the
// setup card renders on null, so a missing plan and a missing table look the
// same to the UI.
export async function getStudyPlan(): Promise<StudyPlanRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('study_plans')
    .select('target_score, test_date, sessions_per_week, timezone')
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[planner] getStudyPlan failed:', error.message);
    return null;
  }
  const row = data as {
    target_score: number;
    test_date: string | null;
    sessions_per_week: number;
    timezone: string | null;
  };
  return {
    targetScore: row.target_score,
    testDate: row.test_date,
    sessionsPerWeek: row.sessions_per_week,
    // `timezone` may be absent on a pre-migration row (select silently omits an
    // unknown column) — coalesce to null so the week boundary falls back to UTC.
    timezone: row.timezone ?? null,
  };
}

// ---------------------------------------------------------------------------
// miss-reason mix — sat.miss_reason_mix() RPC (invoker; RLS-scoped).
// ---------------------------------------------------------------------------

async function getMissReasonMix(): Promise<MissReasonMixRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema('sat').rpc('miss_reason_mix');
  if (error || !data) {
    if (error) console.error('[planner] miss_reason_mix rpc failed:', error.message);
    return [];
  }
  const rows = data as {
    skill: string;
    miss_reason: string;
    cnt: number | string;
  }[];
  return rows.map((r) => ({
    skill: r.skill,
    missReason: r.miss_reason,
    // bigint counts can arrive as strings from PostgREST — coerce with Number().
    cnt: Number(r.cnt),
  }));
}

// ---------------------------------------------------------------------------
// this-week activity — drilled skills + short/full test counts this ISO week.
// ---------------------------------------------------------------------------
//
// Both reads are RLS-scoped user-client selects; on error they degrade to an
// empty result (no activity) so the plan simply shows nothing done rather than
// throwing.

async function getThisWeek(weekStartIso: string): Promise<{
  drilledSkills: string[];
  shortTests: number;
  fullTests: number;
}> {
  const supabase = await createClient();

  // Drilled skills this week — distinct skills from practice_sessions.
  const drilledSkills: string[] = [];
  {
    const { data, error } = await supabase
      .schema('sat')
      .from('practice_sessions')
      .select('skill')
      .gte('created_at', weekStartIso);
    if (error) {
      console.error('[planner] getThisWeek practice_sessions failed:', error.message);
    } else {
      const seen = new Set<string>();
      for (const row of (data ?? []) as { skill: string }[]) {
        if (row.skill && !seen.has(row.skill)) {
          seen.add(row.skill);
          drilledSkills.push(row.skill);
        }
      }
    }
  }

  // Short / full tests this week — from test_attempts, split by test_length.
  let shortTests = 0;
  let fullTests = 0;
  {
    const { data, error } = await supabase
      .schema('sat')
      .from('test_attempts')
      .select('test_length')
      .gte('created_at', weekStartIso);
    if (error) {
      console.error('[planner] getThisWeek test_attempts failed:', error.message);
    } else {
      for (const row of (data ?? []) as { test_length: 'short' | 'full' }[]) {
        if (row.test_length === 'full') fullTests += 1;
        else shortTests += 1;
      }
    }
  }

  return { drilledSkills, shortTests, fullTests };
}

// ---------------------------------------------------------------------------
// getPlannerInputs — the one assembler the /plan page and integrations call.
// ---------------------------------------------------------------------------

export async function getPlannerInputs(): Promise<PlannerInputs> {
  const now = new Date();
  const nowIso = now.toISOString();

  // The this-week boundary depends on the plan's captured timezone, so the plan
  // read must resolve BEFORE getThisWeek's window is known. Fetch it first (a
  // cheap RLS select), derive the Monday-00:00-in-zone boundary, then fan out the
  // remaining independent reads. Plan-less users → weekStartInTz(now, null) = UTC.
  const plan = await getStudyPlan();
  const weekStartIso = weekStartInTz(nowIso, plan?.timezone ?? null);

  // Fan out the independent reads. getAnalytics already reads listAttempts, but
  // we also need the raw attempts (for last-test / last-full-test timestamps and
  // the recent-scores tail), so we fetch attempts here too — cheap RLS select.
  const [analytics, practiceStats, missReasonMix, thisWeek, attempts] =
    await Promise.all([
      getAnalytics(),
      getPracticeSkillStats(),
      getMissReasonMix(),
      getThisWeek(weekStartIso),
      listAttempts(),
    ]);

  // attempts are newest-first (listAttempts order). lastTestAt is the newest;
  // lastFullTestAt is the newest full attempt.
  const lastTestAt = attempts.length > 0 ? attempts[0].created_at : null;
  const lastFullTestAt =
    attempts.find((a) => a.test_length === 'full')?.created_at ?? null;

  // recentScores newest-LAST (compute expects `.at(-1)` = latest). The trend
  // from getAnalytics is already oldest-first, so its tail is the newest run.
  const recentScores = analytics.trend.map((t) => t.score);

  return {
    skills: analytics.skills,
    practiceStats,
    missReasonMix,
    testsTaken: analytics.summary.testsTaken,
    lastTestAt,
    lastFullTestAt,
    recentScores,
    plan: plan
      ? {
          targetScore: plan.targetScore,
          testDate: plan.testDate,
          sessionsPerWeek: plan.sessionsPerWeek,
        }
      : null,
    thisWeek,
    today: nowIso,
  };
}
