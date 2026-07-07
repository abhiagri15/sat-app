import { createClient } from '@/app/lib/supabase/server';
import { listAttempts } from '@/app/lib/persistence/queries';
import {
  summarize,
  type AnalyticsView,
  type SkillStat,
  type SectionStat,
} from './compute';

interface UserAnalyticsRpc {
  skills: SkillStat[];
  sections: SectionStat[];
}

// Assembles the analytics view: per-skill/section aggregates from the
// user_analytics RPC, the score trend + summary from the attempt list.
export async function getAnalytics(): Promise<AnalyticsView> {
  const supabase = await createClient();
  const attempts = await listAttempts();

  let skills: SkillStat[] = [];
  let sections: SectionStat[] = [];
  const { data, error } = await supabase.schema('sat').rpc('user_analytics');
  if (error) {
    console.error('[getAnalytics] user_analytics rpc failed:', error);
  } else if (data) {
    const rpc = data as UserAnalyticsRpc;
    skills = rpc.skills ?? [];
    sections = rpc.sections ?? [];
  }

  // listAttempts is newest-first; the trend reads oldest-first.
  const trend = [...attempts]
    .reverse()
    .map((a) => ({ date: a.created_at, score: a.scaled_score }));

  return { summary: summarize(attempts, skills), sections, skills, trend };
}

// One per-skill/section pacing row from sat.user_pacing(). `responses`/`timed`
// are counts (PostgREST can serialize bigint as a string — coerced via Number);
// `avgMs` is the mean active-display time over non-null time_ms samples only.
export interface PacingRow {
  skill: string;
  section: 'rw' | 'math';
  responses: number;
  timed: number;
  avgMs: number;
}

// Per-skill/section pacing for the signed-in user (design spec §A). Reads the
// sat.user_pacing() RPC (security INVOKER — RLS confines it to the caller).
// Rows with no timed samples still come back (timed = 0); the UI filters them.
export async function getPacing(): Promise<PacingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema('sat').rpc('user_pacing');
  if (error || !data) {
    if (error) console.error('[getPacing] user_pacing rpc failed:', error);
    return [];
  }
  const rows = data as {
    skill: string;
    section: string;
    responses: number | string;
    timed: number | string;
    avg_ms: number | string | null;
  }[];
  return rows.map((r) => ({
    skill: r.skill,
    section: r.section === 'math' ? 'math' : 'rw',
    // bigint counts arrive as strings via PostgREST — coerce with Number().
    responses: Number(r.responses),
    timed: Number(r.timed),
    avgMs: r.avg_ms == null ? 0 : Number(r.avg_ms),
  }));
}
