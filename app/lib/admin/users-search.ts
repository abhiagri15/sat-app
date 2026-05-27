import { z } from 'zod';

export const ROLES        = ['all', 'student', 'admin'] as const;
export const ACTIVITIES   = ['all', 'active', 'inactive', 'never'] as const;
export const JOINED       = ['all', '7', '30', '90'] as const;
export const SCORE_BANDS  = ['all', 'lt-1000', '1000-1200', '1200-1400', 'gte-1400'] as const;
export const SORT_KEYS    = [
  'name', 'email', 'role', 'tests', 'avg_score', 'last_active', 'joined',
] as const;
export const SORT_DIRS    = ['asc', 'desc'] as const;

export type Role       = (typeof ROLES)[number];
export type Activity   = (typeof ACTIVITIES)[number];
export type Joined     = (typeof JOINED)[number];
export type ScoreBand  = (typeof SCORE_BANDS)[number];
export type SortKey    = (typeof SORT_KEYS)[number];
export type SortDir    = (typeof SORT_DIRS)[number];

export interface UsersSearchParams {
  q:        string;
  role:     Role;
  activity: Activity;
  joined:   Joined;
  score:    ScoreBand;
  sort:     SortKey;
  dir:      SortDir;
  page:     number;
}

export const PAGE_SIZE = 25;

export const DEFAULTS: UsersSearchParams = {
  q: '',
  role: 'all',
  activity: 'all',
  joined: 'all',
  score: 'all',
  sort: 'last_active',
  dir: 'desc',
  page: 1,
};

const rawSchema = z.object({
  q:        z.string().optional(),
  role:     z.enum(ROLES).optional(),
  activity: z.enum(ACTIVITIES).optional(),
  joined:   z.enum(JOINED).optional(),
  score:    z.enum(SCORE_BANDS).optional(),
  sort:     z.enum(SORT_KEYS).optional(),
  dir:      z.enum(SORT_DIRS).optional(),
  page:     z.coerce.number().int().positive().max(10_000).optional(),
});

// Coerces a Next.js searchParams record into a fully populated
// UsersSearchParams. Bad input falls back to DEFAULTS silently — never
// throws, so the page never 500s on a hostile URL.
export function parseUsersSearchParams(
  raw: Record<string, string | string[] | undefined>,
): UsersSearchParams {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    flat[k] = Array.isArray(v) ? v[0] : v;
  }
  const parsed = rawSchema.safeParse(flat);
  const v = parsed.success ? parsed.data : {};
  return {
    q:        (v.q ?? DEFAULTS.q).slice(0, 200),
    role:     v.role     ?? DEFAULTS.role,
    activity: v.activity ?? DEFAULTS.activity,
    joined:   v.joined   ?? DEFAULTS.joined,
    score:    v.score    ?? DEFAULTS.score,
    sort:     v.sort     ?? DEFAULTS.sort,
    dir:      v.dir      ?? DEFAULTS.dir,
    page:     v.page     ?? DEFAULTS.page,
  };
}

// Default-valued fields are omitted so canonical URLs stay short.
export function paramsToSearchParams(p: UsersSearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.q        !== DEFAULTS.q)        sp.set('q',        p.q);
  if (p.role     !== DEFAULTS.role)     sp.set('role',     p.role);
  if (p.activity !== DEFAULTS.activity) sp.set('activity', p.activity);
  if (p.joined   !== DEFAULTS.joined)   sp.set('joined',   p.joined);
  if (p.score    !== DEFAULTS.score)    sp.set('score',    p.score);
  if (p.sort     !== DEFAULTS.sort)     sp.set('sort',     p.sort);
  if (p.dir      !== DEFAULTS.dir)      sp.set('dir',      p.dir);
  if (p.page     !== DEFAULTS.page)     sp.set('page',     String(p.page));
  return sp;
}

export function buildUsersHref(p: UsersSearchParams): string {
  const s = paramsToSearchParams(p).toString();
  return s.length === 0 ? '/admin/users' : `/admin/users?${s}`;
}

export function scoreBandToRange(b: ScoreBand): {
  min: number | null;
  max: number | null;
} {
  switch (b) {
    case 'all':       return { min: null, max: null };
    case 'lt-1000':   return { min: null, max: 999 };
    case '1000-1200': return { min: 1000, max: 1199 };
    case '1200-1400': return { min: 1200, max: 1399 };
    case 'gte-1400':  return { min: 1400, max: null };
  }
}

export function joinedToDays(j: Joined): number | null {
  return j === 'all' ? null : parseInt(j, 10);
}
