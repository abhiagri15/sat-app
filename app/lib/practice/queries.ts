import { cache } from 'react';
import { createClient } from '@/app/lib/supabase/server';

// Per-skill practice aggregates for the signed-in user (from the
// sat.practice_skill_stats RPC). Practice results deliberately do NOT feed
// /analytics — this is the only surface that reads them.
export interface PracticeSkillStat {
  skill: string;
  sessions: number;
  questions: number;
  correct: number;
  lastPracticed: string | null;
}

// One row of the practice_skill_stats() RPC (snake_case, bigint counts arrive
// as numbers from supabase-js).
interface PracticeSkillStatRow {
  skill: string;
  sessions: number;
  questions: number;
  correct: number;
  last_practiced: string | null;
}

// Reads sat.practice_skill_stats() and keys the result by skill. On error,
// logs and returns {} so the page still renders (graceful degradation).
export const getPracticeSkillStats = cache(async function getPracticeSkillStats(): Promise<
  Record<string, PracticeSkillStat>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('practice_skill_stats');
  if (error) {
    console.error('[practice] practice_skill_stats rpc failed:', error);
    return {};
  }
  const rows = (data ?? []) as unknown as PracticeSkillStatRow[];
  const bySkill: Record<string, PracticeSkillStat> = {};
  for (const row of rows) {
    bySkill[row.skill] = {
      skill: row.skill,
      sessions: Number(row.sessions),
      questions: Number(row.questions),
      correct: Number(row.correct),
      lastPracticed: row.last_practiced,
    };
  }
  return bySkill;
});

// One recent drill row, as listed on a skill page.
export interface RecentDrill {
  id: string;
  createdAt: string;
  total: number;
  correct: number;
}

// One sat.practice_sessions row (RLS-scoped to the signed-in user).
interface PracticeSessionRow {
  id: string;
  created_at: string;
  total: number;
  correct: number;
}

// The signed-in user's most recent drills for one skill, newest first (RLS
// scopes the rows to them). On error, logs and returns [].
export async function getRecentDrills(
  skill: string,
  limit = 5,
): Promise<RecentDrill[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('practice_sessions')
    .select('id, created_at, total, correct')
    .eq('skill', skill)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[practice] getRecentDrills failed:', error);
    return [];
  }
  const rows = (data ?? []) as unknown as PracticeSessionRow[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    total: r.total,
    correct: r.correct,
  }));
}
