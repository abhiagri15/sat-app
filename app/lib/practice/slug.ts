import { SKILLS, type SectionKey } from '@/app/lib/questions';

// URL slugs for skill names ("Boundaries (Punctuation)" →
// "boundaries-punctuation", "Ratios & Proportions" → "ratios-and-proportions").
// The reverse map is built once from the SKILLS taxonomy; check-lessons.ts
// asserts round-trip and uniqueness for every skill.

export function skillSlug(skill: string): string {
  return skill
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface SlugEntry {
  section: SectionKey;
  skill: string;
}

const SLUG_MAP: Record<string, SlugEntry> = {};
for (const section of ['rw', 'math'] as SectionKey[]) {
  for (const skill of SKILLS[section]) {
    SLUG_MAP[skillSlug(skill)] = { section, skill };
  }
}

export function slugToSkill(slug: string): SlugEntry | null {
  return SLUG_MAP[slug] ?? null;
}
