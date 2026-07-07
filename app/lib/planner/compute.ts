// Study-planner compute (#18) — PURE and deterministic, no I/O, no AI.
//
// Everything the planner needs (including `today`) is passed in via
// `PlannerInputs`; there is NO `Date.now()` inside this module — that keeps it
// testable (scripts/check-planner.ts pins `today` and asserts exact output).
//
// The weekly plan is COMPUTED and completion is DERIVED from this week's actual
// activity (`inputs.thisWeek`) — there are no stored plan-item checkboxes, so a
// plan can never go stale (spec §B "Data").
//
// Every exported function is total: it must NEVER throw, even on zero-history
// or empty inputs (the zero-history fixture asserts this).

import {
  SKILLS,
  SECTION_ORDER,
  type SectionKey,
} from '@/app/lib/questions';
import { skillSlug } from '@/app/lib/practice/slug';
import {
  accuracyPct,
  sortSkillsWeakestFirst,
  focusAreas,
  type SkillStat,
} from '@/app/lib/analytics/compute';
import { MISS_REASONS } from '@/app/lib/practice/miss-reasons';
import type { PracticeSkillStat } from '@/app/lib/practice/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// One aggregated (skill, missReason) count — the shape of a
// `sat.miss_reason_mix()` row after the query layer normalises it.
export interface MissReasonMixRow {
  skill: string;
  missReason: string;
  cnt: number;
}

// The single object a server query assembles and hands to the compute helpers.
export interface PlannerInputs {
  // Per-skill TEST accuracy (the focus-area stats — same shape as analytics).
  skills: SkillStat[];
  // Per-skill practice recency + drill counts, keyed by skill name.
  practiceStats: Record<string, PracticeSkillStat>;
  // Tagged-incorrect responses grouped by (skill, missReason) with counts.
  missReasonMix: MissReasonMixRow[];
  // How many tests the user has saved (0 → zero-history path).
  testsTaken: number;
  // ISO timestamp of the most recent test attempt, or null.
  lastTestAt: string | null;
  // ISO timestamp of the most recent FULL test attempt, or null.
  lastFullTestAt: string | null;
  // Recent scaled scores, newest-LAST (so recentScores.at(-1) is the latest).
  recentScores: number[];
  // The user's plan row, or null when they have not set one up yet.
  plan: {
    targetScore: number;
    testDate: string | null;
    sessionsPerWeek: number;
  } | null;
  // This ISO week's activity — the source of `done` derivation.
  thisWeek: {
    drilledSkills: string[];
    shortTests: number;
    fullTests: number;
  };
  // Anchor date (ISO string, e.g. "2026-07-07"). No Date.now() inside compute.
  today: string;
}

export interface PlanItem {
  kind: 'drill' | 'test';
  skill?: string;
  slug?: string;
  label: string;
  why: string;
  done: boolean;
  href: string;
}

export interface OverdueSkill {
  section: SectionKey;
  skill: string;
  slug: string;
  accuracy: number; // 0-100 tested accuracy
  href: string;
}

export interface PaceSummary {
  current: number | null; // estimated current score
  target: number | null;
  gap: number | null; // target - current (positive = points to gain)
  daysToTest: number | null;
  weeksToTest: number | null;
  paceNote: string;
}

// Default number of weekly slots when no plan row exists yet (spec default is
// 4 sessions/week; the setup card writes a real value later).
const DEFAULT_SESSIONS_PER_WEEK = 4;
const OVERDUE_ACCURACY_THRESHOLD = 75; // tested accuracy < 75% is "weak"
const RECENCY_DAYS = 14; // "never drilled OR > 14 days ago"
const FULL_TEST_HORIZON_DAYS = 14; // test date ≥ 14 days away → suggest a full test
const OVERDUE_CAP = 8;

// ---------------------------------------------------------------------------
// Date helpers (pure — operate on ISO strings / Date, no Date.now())
// ---------------------------------------------------------------------------

// Days elapsed from `fromIso` up to `todayIso` (positive = in the past).
// Returns null for an unparseable / null input. Uses UTC-midnight day math so
// it is timezone-stable and matches the check fixtures.
function daysSince(fromIso: string | null, todayIso: string): number | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const today = Date.parse(todayIso);
  if (Number.isNaN(from) || Number.isNaN(today)) return null;
  return Math.floor((today - from) / 86_400_000);
}

// Days from `todayIso` UNTIL `toIso` (positive = in the future). Null on bad
// input. Ceil so "0.5 days away" still reads as 1 day to go.
function daysUntil(toIso: string | null, todayIso: string): number | null {
  if (!toIso) return null;
  const to = Date.parse(toIso);
  const today = Date.parse(todayIso);
  if (Number.isNaN(to) || Number.isNaN(today)) return null;
  return Math.ceil((to - today) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Miss-reason helpers
// ---------------------------------------------------------------------------

// Keyed on plain string (mix rows carry an untyped `missReason` off the DB, so
// the lookup must tolerate any string — the SQL CHECK is the value guard).
const MISS_LABEL: Map<string, string> = new Map(
  MISS_REASONS.map((r) => [r.value, r.label]),
);
const MISS_ORDER: Map<string, number> = new Map(
  MISS_REASONS.map((r, i) => [r.value, i]),
);

// The dominant (highest-count) miss reason for a skill, or null when the skill
// has no tagged misses. Deterministic tie-break: higher count, then the order
// the reasons appear in MISS_REASONS (stable, not alphabetical on the value).
function dominantMissReason(
  skill: string,
  mix: MissReasonMixRow[],
): string | null {
  const rows = mix.filter((m) => m.skill === skill && m.cnt > 0);
  if (rows.length === 0) return null;
  let best = rows[0];
  for (const row of rows.slice(1)) {
    if (row.cnt > best.cnt) {
      best = row;
    } else if (row.cnt === best.cnt) {
      const a = MISS_ORDER.get(row.missReason) ?? Number.MAX_SAFE_INTEGER;
      const b = MISS_ORDER.get(best.missReason) ?? Number.MAX_SAFE_INTEGER;
      if (a < b) best = row;
    }
  }
  return best.missReason;
}

// ---------------------------------------------------------------------------
// `why` string construction (reason-aware — spec §B)
// ---------------------------------------------------------------------------
//
// - dominant reason 'time_pressure' → pacing phrasing (drill untimed, watch the
//   pacing panel).
// - dominant reason 'careless'      → accuracy-over-speed phrasing.
// - any other dominant reason       → evidence phrasing citing the accuracy AND
//   the dominant miss label ("42% on tests · mostly 'ran out of time' misses").
// - no dominant reason              → plain accuracy phrasing.

function drillWhy(
  skill: string,
  stat: SkillStat | null,
  mix: MissReasonMixRow[],
): string {
  const acc =
    stat && stat.total > 0 ? accuracyPct(stat.correct, stat.total) : null;
  const accPhrase = acc === null ? 'not yet measured on tests' : `${acc}% on tests`;
  const dominant = dominantMissReason(skill, mix);

  if (dominant === 'time_pressure') {
    return `${accPhrase} · mostly timing — drill untimed first, then watch the pacing panel.`;
  }
  if (dominant === 'careless') {
    return `${accPhrase} · mostly careless slips — slow down and prize accuracy over speed.`;
  }
  if (dominant) {
    const label = (MISS_LABEL.get(dominant) ?? dominant).toLowerCase();
    return `${accPhrase} · mostly '${label}' misses.`;
  }
  return `${accPhrase} — targeted reps sharpen this skill.`;
}

// ---------------------------------------------------------------------------
// Skill lookups
// ---------------------------------------------------------------------------

// Section for a skill from the SKILLS taxonomy (rw checked first, then math).
function sectionForSkill(skill: string): SectionKey | null {
  for (const section of SECTION_ORDER) {
    if (SKILLS[section].includes(skill)) return section;
  }
  return null;
}

// The full (section, skill) list from the taxonomy, deterministic order
// (section order, then the taxonomy's own listing order).
function allTaxonomySkills(): { section: SectionKey; skill: string }[] {
  const out: { section: SectionKey; skill: string }[] = [];
  for (const section of SECTION_ORDER) {
    for (const skill of SKILLS[section]) out.push({ section, skill });
  }
  return out;
}

function drillHref(skill: string): string {
  return `/practice/${skillSlug(skill)}?drill=1`;
}

function drillItem(
  skill: string,
  stat: SkillStat | null,
  inputs: PlannerInputs,
  labelPrefix = 'Drill',
): PlanItem {
  return {
    kind: 'drill',
    skill,
    slug: skillSlug(skill),
    label: `${labelPrefix} ${skill}`,
    why: drillWhy(skill, stat, inputs.missReasonMix),
    done: inputs.thisWeek.drilledSkills.includes(skill),
    href: drillHref(skill),
  };
}

// ---------------------------------------------------------------------------
// overdueSkills
// ---------------------------------------------------------------------------
//
// Tested accuracy < 75% AND (never drilled OR last practiced > 14 days ago).
// "Never drilled" = absent from the practice-stats map. Iterates the FULL
// SKILLS taxonomy (not just practiced keys), weakest first, capped 8.

export function overdueSkills(inputs: PlannerInputs): OverdueSkill[] {
  const statBySkill = new Map(inputs.skills.map((s) => [s.skill, s] as const));
  const overdue: OverdueSkill[] = [];

  for (const { section, skill } of allTaxonomySkills()) {
    const stat = statBySkill.get(skill);
    // Must have been TESTED (total > 0) and be below the accuracy threshold.
    if (!stat || stat.total === 0) continue;
    const acc = accuracyPct(stat.correct, stat.total);
    if (acc >= OVERDUE_ACCURACY_THRESHOLD) continue;

    // Recency gate: never drilled, or last practiced > 14 days ago.
    const practice = inputs.practiceStats[skill];
    const neverDrilled = !practice;
    let stale = false;
    if (!neverDrilled) {
      const elapsed = daysSince(practice.lastPracticed, inputs.today);
      // Unparseable / null lastPracticed is treated as stale (surface it).
      stale = elapsed === null ? true : elapsed > RECENCY_DAYS;
    }
    if (!neverDrilled && !stale) continue;

    overdue.push({
      section,
      skill,
      slug: skillSlug(skill),
      accuracy: acc,
      href: drillHref(skill),
    });
  }

  // Weakest first — reuse the analytics ordering (accuracy asc, then more-
  // answered first, then skill name) via a SkillStat projection.
  const ordered = sortSkillsWeakestFirst(
    overdue.map((o) => {
      const stat = statBySkill.get(o.skill)!;
      return stat;
    }),
  );
  const rank = new Map(ordered.map((s, i) => [s.skill, i] as const));
  overdue.sort(
    (a, b) =>
      (rank.get(a.skill) ?? 0) - (rank.get(b.skill) ?? 0) ||
      a.skill.localeCompare(b.skill),
  );

  return overdue.slice(0, OVERDUE_CAP);
}

// ---------------------------------------------------------------------------
// buildWeekPlan
// ---------------------------------------------------------------------------
//
// Fills `sessionsPerWeek` slots in priority order (spec §B):
//   1. Drill focus-area skill #1 (weakest tested skill).
//   2. Drill focus-area skill #2.
//   3. "Review your misses" — drill the skill with the most recent wrong
//      answers (uses the miss-reason mix as the proxy for "most misses").
//   4. A short test if none this week; a FULL test instead when the test date
//      is ≥ 14 days away AND no full test in the last 14 days.
//   5. Remaining slots: overdue skills (weakest first), de-duped.
//
// Zero-history (testsTaken === 0): lead with a "Take your first test" item and
// seed the remaining drill slots from the SKILLS taxonomy (deterministic).

export function buildWeekPlan(inputs: PlannerInputs): PlanItem[] {
  const slots = Math.max(
    1,
    inputs.plan?.sessionsPerWeek ?? DEFAULT_SESSIONS_PER_WEEK,
  );
  const items: PlanItem[] = [];
  const usedSkills = new Set<string>();
  const statBySkill = new Map(inputs.skills.map((s) => [s.skill, s] as const));

  // --- Zero-history path ---------------------------------------------------
  if (inputs.testsTaken === 0) {
    items.push(firstTestItem(inputs));
    // Seed drills from the taxonomy in deterministic order until slots fill.
    for (const { skill } of allTaxonomySkills()) {
      if (items.length >= slots) break;
      if (usedSkills.has(skill)) continue;
      usedSkills.add(skill);
      const item = drillItem(skill, statBySkill.get(skill) ?? null, inputs);
      // Seed drills have no test accuracy yet — a friendlier "start here" why.
      item.why = 'A core skill to build a base before your first test.';
      items.push(item);
    }
    return items.slice(0, slots);
  }

  // --- Rich-history path ---------------------------------------------------

  // Slots 1 & 2: the two weakest tested skills (focus areas).
  const focus = focusAreas(inputs.skills, 2);
  for (const stat of focus) {
    if (items.length >= slots) break;
    if (usedSkills.has(stat.skill)) continue;
    usedSkills.add(stat.skill);
    items.push(drillItem(stat.skill, stat, inputs));
  }

  // Slot 3: "Review your misses" — the skill with the most tagged misses
  // (most-recent-wrong proxy). Skip any skill already slotted above.
  if (items.length < slots) {
    const missSkill = topMissSkill(inputs, usedSkills);
    if (missSkill) {
      usedSkills.add(missSkill);
      const stat = statBySkill.get(missSkill) ?? null;
      const item = drillItem(missSkill, stat, inputs, 'Review your misses in');
      items.push(item);
    }
  }

  // Slot 4: a test (short by default; full when far-off test date + no recent
  // full test).
  if (items.length < slots) {
    items.push(testItem(inputs));
  }

  // Slot 5+: overdue skills, weakest first, not already slotted.
  if (items.length < slots) {
    for (const od of overdueSkills(inputs)) {
      if (items.length >= slots) break;
      if (usedSkills.has(od.skill)) continue;
      usedSkills.add(od.skill);
      items.push(drillItem(od.skill, statBySkill.get(od.skill) ?? null, inputs));
    }
  }

  return items.slice(0, slots);
}

// The skill with the most tagged incorrect responses (proxy for "most recent
// wrong answers"), excluding already-slotted skills. Deterministic tie-break:
// higher total, then weakest tested accuracy, then skill name.
function topMissSkill(
  inputs: PlannerInputs,
  exclude: Set<string>,
): string | null {
  const totals = new Map<string, number>();
  for (const row of inputs.missReasonMix) {
    if (exclude.has(row.skill)) continue;
    if (row.cnt <= 0) continue;
    totals.set(row.skill, (totals.get(row.skill) ?? 0) + row.cnt);
  }
  if (totals.size === 0) return null;

  const statBySkill = new Map(inputs.skills.map((s) => [s.skill, s] as const));
  const accOf = (skill: string): number => {
    const s = statBySkill.get(skill);
    return s && s.total > 0 ? accuracyPct(s.correct, s.total) : 101; // untested → last
  };

  let bestSkill: string | null = null;
  let bestTotal = -1;
  for (const [skill, total] of totals) {
    if (
      total > bestTotal ||
      (total === bestTotal &&
        bestSkill !== null &&
        (accOf(skill) < accOf(bestSkill) ||
          (accOf(skill) === accOf(bestSkill) &&
            skill.localeCompare(bestSkill) < 0)))
    ) {
      bestSkill = skill;
      bestTotal = total;
    }
  }
  return bestSkill;
}

// The test slot. Short test unless the test date is ≥ 14 days away AND no full
// test in the last 14 days → then a full test.
function testItem(inputs: PlannerInputs): PlanItem {
  const daysToTest = daysUntil(inputs.plan?.testDate ?? null, inputs.today);
  const lastFullElapsed = daysSince(inputs.lastFullTestAt, inputs.today);
  const noRecentFull =
    lastFullElapsed === null || lastFullElapsed > FULL_TEST_HORIZON_DAYS;
  const wantFull =
    daysToTest !== null && daysToTest >= FULL_TEST_HORIZON_DAYS && noRecentFull;

  if (wantFull) {
    return {
      kind: 'test',
      label: 'Take a full practice test',
      why: `Your test is ${daysToTest} days out — a full, timed run builds stamina and a fresh score estimate.`,
      done: inputs.thisWeek.fullTests > 0,
      href: '/',
    };
  }
  return {
    kind: 'test',
    label: 'Take a short practice test',
    why: 'A quick timed check keeps your score estimate current.',
    done: inputs.thisWeek.shortTests > 0 || inputs.thisWeek.fullTests > 0,
    href: '/',
  };
}

// The zero-history lead item.
function firstTestItem(inputs: PlannerInputs): PlanItem {
  return {
    kind: 'test',
    label: 'Take your first practice test',
    why: 'One timed test gives you a baseline score and unlocks your focus areas.',
    done: inputs.thisWeek.shortTests > 0 || inputs.thisWeek.fullTests > 0,
    href: '/',
  };
}

// ---------------------------------------------------------------------------
// paceSummary
// ---------------------------------------------------------------------------
//
// Current estimate = average of the last 3 recent scores, else the last score,
// else null. Target/gap from the plan. days/weeks to the test date (null when
// there is no test date). One-line pace note.

export function paceSummary(inputs: PlannerInputs): PaceSummary {
  const scores = inputs.recentScores;
  let current: number | null = null;
  if (scores.length >= 3) {
    const last3 = scores.slice(-3);
    current = Math.round(last3.reduce((s, n) => s + n, 0) / last3.length);
  } else if (scores.length > 0) {
    current = scores[scores.length - 1];
  }

  const target = inputs.plan?.targetScore ?? null;
  const gap = current !== null && target !== null ? target - current : null;

  const daysToTest = daysUntil(inputs.plan?.testDate ?? null, inputs.today);
  const weeksToTest =
    daysToTest === null ? null : Math.max(0, Math.ceil(daysToTest / 7));

  return {
    current,
    target,
    gap,
    daysToTest,
    weeksToTest,
    paceNote: buildPaceNote(current, target, gap, daysToTest, weeksToTest),
  };
}

function buildPaceNote(
  current: number | null,
  target: number | null,
  gap: number | null,
  daysToTest: number | null,
  weeksToTest: number | null,
): string {
  if (current === null) {
    return 'Take a test to establish your current score estimate.';
  }
  if (target === null) {
    return 'Set a target score to track your progress toward it.';
  }
  if (gap !== null && gap <= 0) {
    return daysToTest !== null
      ? `You are already at your target — keep it sharp with ${daysToTest} days to go.`
      : 'You are already at your target — keep it sharp.';
  }
  // gap > 0
  if (daysToTest === null || weeksToTest === null) {
    return `${gap} points to your target. Set a test date to pace the climb.`;
  }
  if (daysToTest <= 0) {
    return `${gap} points to your target and test day is here — focus on accuracy today.`;
  }
  const perWeek = Math.ceil((gap ?? 0) / Math.max(1, weeksToTest));
  return `${gap} points to go in ~${weeksToTest} week${
    weeksToTest === 1 ? '' : 's'
  } — about ${perWeek} points a week.`;
}
