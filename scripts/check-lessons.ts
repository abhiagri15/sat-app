// Scripted check for the Practice lessons registry (no unit-test runner — see
// CLAUDE.md). Proves every skill in SKILLS has a complete, contract-conforming
// lesson with a unique, round-tripping slug.
// Run: pnpm dlx tsx scripts/check-lessons.ts
import { SKILLS, type SectionKey } from '../app/lib/questions';
import { getLesson, LESSONS } from '../app/lib/lessons';
import type { Lesson } from '../app/lib/lessons';
import { skillSlug, slugToSkill } from '../app/lib/practice/slug';
import { parseSpr } from '../app/lib/spr';

let passed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  passed += 1;
}

const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;

const LETTER_REF = /\b(choice|option)\s+[a-d1-4]\b/i;

const allSkills: { section: SectionKey; skill: string }[] = [];
for (const section of ['rw', 'math'] as SectionKey[]) {
  for (const skill of SKILLS[section]) {
    allSkills.push({ section, skill });
  }
}

for (const { skill } of allSkills) {
  // 1. Lesson exists and skill matches.
  const lesson = getLesson(skill);
  assert(lesson !== null, `getLesson("${skill}") is non-null`);
  const l = lesson as Lesson;
  assert(l.skill === skill, `lesson.skill === "${skill}"`);

  // 2. Bounds.
  assert(nonEmpty(l.tagline), `"${skill}" tagline non-empty`);
  assert(
    l.overview.length >= 1 && l.overview.length <= 3,
    `"${skill}" overview length 1–3 (got ${l.overview.length})`,
  );
  assert(l.overview.every(nonEmpty), `"${skill}" overview paragraphs non-empty`);
  assert(
    l.strategies.length >= 3 && l.strategies.length <= 5,
    `"${skill}" strategies length 3–5 (got ${l.strategies.length})`,
  );
  assert(
    l.strategies.every((s) => nonEmpty(s.title) && nonEmpty(s.body)),
    `"${skill}" strategies have non-empty titles/bodies`,
  );
  assert(
    l.traps.length >= 2 && l.traps.length <= 4,
    `"${skill}" traps length 2–4 (got ${l.traps.length})`,
  );
  assert(l.traps.every(nonEmpty), `"${skill}" traps non-empty`);
  assert(
    l.workedExample.walkthrough.length >= 2 && l.workedExample.walkthrough.length <= 5,
    `"${skill}" walkthrough length 2–5 (got ${l.workedExample.walkthrough.length})`,
  );
  assert(
    l.workedExample.walkthrough.every(nonEmpty),
    `"${skill}" walkthrough steps non-empty`,
  );

  // 3. Worked example: mcq → exactly 4 choices incl. correct; spr → parses.
  const { choices, correct } = l.workedExample;
  assert(nonEmpty(correct), `"${skill}" worked example correct non-empty`);
  if (choices !== undefined) {
    assert(choices.length === 4, `"${skill}" mcq example has exactly 4 choices (got ${choices.length})`);
    assert(choices.every(nonEmpty), `"${skill}" mcq example choices non-empty`);
    assert(choices.includes(correct), `"${skill}" mcq example correct is one of the choices`);
  } else {
    assert(parseSpr(correct) !== null, `"${skill}" spr example correct parses via parseSpr`);
  }

  // 4. No choice-by-letter references anywhere in the lesson.
  assert(
    !LETTER_REF.test(JSON.stringify(l)),
    `"${skill}" contains no letter/number choice references`,
  );

  // 5. Slug round-trips.
  assert(
    slugToSkill(skillSlug(skill))?.skill === skill,
    `"${skill}" slug round-trips`,
  );
}

// 5 (cont.). All slugs unique across the taxonomy.
const slugs = allSkills.map(({ skill }) => skillSlug(skill));
assert(
  new Set(slugs).size === slugs.length,
  `all ${slugs.length} slugs are unique`,
);

// 6. No orphan lessons — every LESSONS key is a real skill.
const knownSkills = new Set(allSkills.map(({ skill }) => skill));
for (const key of Object.keys(LESSONS)) {
  assert(knownSkills.has(key), `lesson key "${key}" appears in SKILLS`);
}

console.log(`check-lessons: ${passed} assertions passed`);
