import type { Lesson } from './types';
import { RW_INFORMATION_IDEAS_LESSONS } from './rw-information-ideas';
import { RW_CRAFT_STRUCTURE_LESSONS } from './rw-craft-structure';
import { RW_EXPRESSION_LESSONS } from './rw-expression';
import { RW_CONVENTIONS_LESSONS } from './rw-conventions';
import { MATH_ALGEBRA_LESSONS } from './math-algebra';
import { MATH_ADVANCED_LESSONS } from './math-advanced';
import { MATH_PSDA_LESSONS } from './math-psda';
import { MATH_GEOMETRY_LESSONS } from './math-geometry';

const ALL: Lesson[] = [
  ...RW_INFORMATION_IDEAS_LESSONS,
  ...RW_CRAFT_STRUCTURE_LESSONS,
  ...RW_EXPRESSION_LESSONS,
  ...RW_CONVENTIONS_LESSONS,
  ...MATH_ALGEBRA_LESSONS,
  ...MATH_ADVANCED_LESSONS,
  ...MATH_PSDA_LESSONS,
  ...MATH_GEOMETRY_LESSONS,
];

export const LESSONS: Record<string, Lesson> = Object.fromEntries(
  ALL.map((l) => [l.skill, l]),
);

export function getLesson(skill: string): Lesson | null {
  return LESSONS[skill] ?? null;
}

export type { Lesson, WorkedExample } from './types';
