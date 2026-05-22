import type { AttemptSummary } from '@/app/lib/persistence/queries';

export interface SkillStat {
  section: 'rw' | 'math';
  skill: string;
  total: number;
  correct: number;
}

export interface SectionStat {
  section: 'rw' | 'math';
  total: number;
  correct: number;
}

export interface TrendPoint {
  date: string;
  score: number;
}

export interface AnalyticsSummary {
  testsTaken: number;
  bestScore: number;
  averageScore: number;
  questionsAnswered: number;
}

export interface AnalyticsView {
  summary: AnalyticsSummary;
  sections: SectionStat[];
  skills: SkillStat[];
  trend: TrendPoint[];
}

// Percent correct, 0-100, integer. 0 when no questions.
export function accuracyPct(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((100 * correct) / total);
}

// Skills ascending by accuracy; ties → more-answered first, then skill name.
export function sortSkillsWeakestFirst(skills: SkillStat[]): SkillStat[] {
  return [...skills].sort((a, b) => {
    const pa = accuracyPct(a.correct, a.total);
    const pb = accuracyPct(b.correct, b.total);
    if (pa !== pb) return pa - pb;
    if (a.total !== b.total) return b.total - a.total;
    return a.skill.localeCompare(b.skill);
  });
}

// The n weakest skills the user has actually answered.
export function focusAreas(skills: SkillStat[], n = 3): SkillStat[] {
  return sortSkillsWeakestFirst(skills.filter((s) => s.total > 0)).slice(0, n);
}

// Summary stats from the attempt list + the per-skill totals.
export function summarize(
  attempts: AttemptSummary[],
  skills: SkillStat[],
): AnalyticsSummary {
  const scores = attempts.map((a) => a.scaled_score);
  const testsTaken = attempts.length;
  const bestScore = testsTaken === 0 ? 0 : Math.max(...scores);
  const averageScore =
    testsTaken === 0
      ? 0
      : Math.round(scores.reduce((s, n) => s + n, 0) / testsTaken);
  const questionsAnswered = skills.reduce((s, k) => s + k.total, 0);
  return { testsTaken, bestScore, averageScore, questionsAnswered };
}
