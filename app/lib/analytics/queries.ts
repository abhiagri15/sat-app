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
