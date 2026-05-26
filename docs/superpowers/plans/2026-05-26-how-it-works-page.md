# Public /how-it-works Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, unauthenticated `/how-it-works` page that explains the SAT practice app to students and parents and surfaces live pool numbers.

**Architecture:** New top-level Next.js route outside the `(app)` and `(auth)` route groups. Server component with `revalidate = 3600` ISR. Live pool numbers come from a new sanitized Postgres RPC `sat.public_pool_stats()` granted to `anon`. Page composes ~10 small section components and is linked from `/login` and `/register` footers.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind, Supabase JS client, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-05-26-how-it-works-page-design.md` (commits `4b0542b` + `216e36b`).

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260526NNNNNN_sat_public_pool_stats.sql` | Defines `sat.public_pool_stats()` RPC, granted to `anon`. |
| `app/lib/marketing/queries.ts` | `getPublicPoolStats()` — anon-key RPC wrapper, returns `PublicPoolStats \| null`. |
| `app/how-it-works/page.tsx` | Server component that fetches stats and composes sections. `revalidate = 3600`. |
| `app/how-it-works/_components/MarketingHeader.tsx` | Page-top bar: logo + Sign in + Try it. |
| `app/how-it-works/_components/MarketingFooter.tsx` | Page-bottom bar: copyright + back-to-top + Sign in. |
| `app/how-it-works/_components/AnchorNav.tsx` | Inline anchor links to `#how-it-works`, `#methodology`, `#faq`. Non-sticky. |
| `app/how-it-works/_components/Hero.tsx` | Headline, subhead, live stat strip, two CTAs. |
| `app/how-it-works/_components/WhatYouGet.tsx` | Three-card row (student value props). |
| `app/how-it-works/_components/HowItWorks.tsx` | Four-step subway map. |
| `app/how-it-works/_components/Parity.tsx` | Bulleted "why it's close to the real SAT" claims. |
| `app/how-it-works/_components/QuestionPipeline.tsx` | Methodology section with horizontal flow diagram. |
| `app/how-it-works/_components/PoolComposition.tsx` | 2×3 live grid + last-refreshed timestamp. |
| `app/how-it-works/_components/FaqAccordion.tsx` | 8 FAQ items, native `<details>` (no JS lib needed). |
| `app/how-it-works/_components/CtaFooter.tsx` | "Ready to practice?" with Start / Sign in. |

**Modified files:**

| Path | Change |
|---|---|
| `middleware.ts` | Add `/how-it-works` to `PUBLIC_PATHS`. |
| `app/(auth)/login/page.tsx` | Add "How it works" footer link. |
| `app/(auth)/register/page.tsx` | Add "How it works" footer link. |

**Boundaries:** Each `_components/*` file is presentational only — receives the data it needs as props (or no props), no internal data fetching, no client state in v1 (FAQ uses native `<details>` so no React state). The page (`page.tsx`) is the single fetch site. `queries.ts` is the only file that talks to Supabase. The migration is the single source of truth for the RPC.

---

## Chunk 1: Database — `sat.public_pool_stats()` RPC

### Task 1: Create migration file

**Files:**
- Create: `supabase/migrations/20260526160000_sat_public_pool_stats.sql`

> The `20260526160000` timestamp is `YYYYMMDDHHMMSS` for "today at 16:00 UTC". If a later migration already uses this slot, bump by one minute. Check `supabase/migrations/` before naming.

- [ ] **Step 1: Create the SQL file**

Write the migration:

```sql
-- supabase/migrations/20260526160000_sat_public_pool_stats.sql
--
-- Returns aggregate, non-sensitive pool numbers safe for anonymous callers.
-- No per-skill detail, no worst-student data, no admin config — just headline
-- pool composition that the marketing /how-it-works page can quote.
--
-- Distinct from sat.generator_state(), which exposes operational metrics
-- (minActiveUserUnseen, per-skill worstStudentUnseen) that would leak how
-- many students are active.

create or replace function sat.public_pool_stats()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'totalEnabled',  (select count(*) from sat.questions where enabled),
    'rwCount',       (select count(*) from sat.questions where enabled and section = 'rw'),
    'mathCount',     (select count(*) from sat.questions where enabled and section = 'math'),
    'easyCount',     (select count(*) from sat.questions where enabled and difficulty = 'easy'),
    'mediumCount',   (select count(*) from sat.questions where enabled and difficulty = 'medium'),
    'hardCount',     (select count(*) from sat.questions where enabled and difficulty = 'hard'),
    'skillCount',    (select count(distinct (section, skill)) from sat.questions where enabled),
    'cells', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'section', section,
        'difficulty', difficulty,
        'count', cnt
      )), '[]'::jsonb)
      from (
        select section, difficulty, count(*) as cnt
        from sat.questions
        where enabled
        group by section, difficulty
      ) sub
    ),
    'lastRefreshed', (select max(created_at) from sat.questions where source = 'ai'),
    'asOf',          now()
  );
$$;

grant execute on function sat.public_pool_stats() to anon, authenticated, service_role;
```

> The `cells` array is the 2×3 cross-tab the spec calls for. Each entry is one `(section, difficulty)` pair with its enabled count. Section / difficulty totals are still in `rwCount` / `mathCount` / `easyCount` / `mediumCount` / `hardCount` for convenience — the consumer can render either.

- [ ] **Step 2: Apply via Supabase MCP**

Call `mcp__claude_ai_Supabase__apply_migration`:
- `project_id`: `falgykkspbtrwdcchayi`
- `name`: `sat_public_pool_stats`
- `query`: the SQL above

Expected: `{"success":true}`

- [ ] **Step 3: Verify the RPC works as anon**

In the Supabase SQL editor (or via `mcp__claude_ai_Supabase__execute_sql`), as the anon role, run:

```sql
set role anon;
select sat.public_pool_stats();
reset role;
```

Expected: a JSON object containing `totalEnabled`, `rwCount`, `mathCount`, `easyCount`, `mediumCount`, `hardCount`, `skillCount`, `cells` (array of 6 entries), `lastRefreshed`, `asOf`. **No** `minActiveUserUnseen` or `worstStudentUnseen` field. The `cells` array should have one entry per `(section, difficulty)` pair that has at least one enabled question, with shape `{ section, difficulty, count }`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526160000_sat_public_pool_stats.sql
git commit -m "feat(sat): public_pool_stats RPC for marketing page

Anon-callable aggregate pool stats — total enabled, R&W vs Math, E/M/H,
skill count, last refresh timestamp. Distinct from generator_state to avoid
leaking operational metrics (active user count, per-skill worst unseen)."
```

---

## Chunk 2: Data boundary — `app/lib/marketing/queries.ts`

### Task 2: TypeScript wrapper for the RPC

**Files:**
- Create: `app/lib/marketing/queries.ts`

- [ ] **Step 1: Create the file**

```typescript
// app/lib/marketing/queries.ts
//
// Public-page data fetchers. Uses a plain anon-key Supabase client — NO
// cookie binding — so the marketing page stays compatible with Next.js ISR.
// The existing app/lib/supabase/server.ts is cookie-bound for SSR auth flows;
// binding cookies on a public page would force Next into dynamic rendering
// and defeat revalidate=3600.

import { createClient } from '@supabase/supabase-js';

export interface PublicPoolStatsCell {
  section: 'rw' | 'math';
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
}

export interface PublicPoolStats {
  totalEnabled: number;
  rwCount: number;
  mathCount: number;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
  skillCount: number;
  // 2x3 cross-tab. May omit cells with count 0; consumer should default
  // missing (section, difficulty) keys to 0.
  cells: PublicPoolStatsCell[];
  lastRefreshed: string | null; // ISO timestamp or null if no AI questions yet
  asOf: string; // ISO timestamp of when the RPC ran
}

// Returns null on any error so the calling page can render a graceful
// fallback. We never throw across this boundary.
export async function getPublicPoolStats(): Promise<PublicPoolStats | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data, error } = await supabase.schema('sat').rpc('public_pool_stats');
    if (error || !data) {
      console.error('[getPublicPoolStats] RPC error:', error);
      return null;
    }
    return data as unknown as PublicPoolStats;
  } catch (e) {
    console.error('[getPublicPoolStats] unexpected error:', e);
    return null;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/lib/marketing/queries.ts
git commit -m "feat(marketing): getPublicPoolStats anon-client RPC wrapper

Plain anon-key client (not cookie-bound) so the marketing page stays
ISR-compatible. Returns PublicPoolStats | null — never throws across the
boundary. Calling pages render a fallback on null."
```

---

## Chunk 3: Public route + middleware + scaffolded page

### Task 3: Open the route in middleware

**Files:**
- Modify: `middleware.ts`

- [ ] **Step 1: Add `/how-it-works` to `PUBLIC_PATHS`**

Edit `middleware.ts`. The current `PUBLIC_PATHS` (lines 4-11) is:

```typescript
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/api/admin/generate-questions',
];
```

Add `'/how-it-works',` so it becomes:

```typescript
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/api/admin/generate-questions',
  '/how-it-works',
];
```

> Note: the existing middleware redirects authenticated users away from `/login` and `/register` only. `/how-it-works` is intentionally left out of that redirect block — signed-in users may want to revisit the explainer, so they should see it normally.

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

### Task 4: Scaffold the page that just proves the route is public

**Files:**
- Create: `app/how-it-works/page.tsx`

- [ ] **Step 1: Create a minimal page**

```typescript
// app/how-it-works/page.tsx
//
// Public-facing explainer for the SAT practice app. Server component with
// ISR (revalidate = 3600) — the page is regenerated at most once an hour,
// so live pool numbers may lag by up to 60 minutes (acceptable for a
// marketing page; no one reloads twice in an hour).

export const revalidate = 3600;

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-3xl font-bold">How it works</h1>
      <p className="mt-4 text-slate-600">Coming soon.</p>
    </main>
  );
}
```

- [ ] **Step 2: Run the dev server and check the route**

```bash
pnpm dev
```

In a browser:
- Signed OUT: visit `http://localhost:3000/how-it-works` → see the heading + "Coming soon." Should NOT redirect to `/login`.
- Signed IN: visit the same URL → see the same page. Should NOT redirect to `/`.

Stop the dev server.

- [ ] **Step 3: Type-check and build**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Expected: both pass. `pnpm build` output should show `/how-it-works` as a static (○) or ISR (⊕) route.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts app/how-it-works/page.tsx
git commit -m "feat(how-it-works): scaffold public /how-it-works route

Adds /how-it-works to PUBLIC_PATHS in middleware and a placeholder page
component with revalidate=3600 ISR. Content sections land in follow-up
commits."
```

---

## Chunk 4: Marketing chrome + content sections

> All section components are stateless presentational React. They receive props (or none) and render JSX + Tailwind. No client-side hooks. Native `<details>` for the FAQ accordion keeps the page server-only.

### Task 5: MarketingHeader

**Files:**
- Create: `app/how-it-works/_components/MarketingHeader.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/MarketingHeader.tsx
import Link from 'next/link';

// Page-top bar shown on the marketing /how-it-works page only. Distinct
// from AppHeader (which is built around authenticated user state).
export function MarketingHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-semibold text-slate-900">
          SAT Practice
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Try it free
          </Link>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. Component is unused for now; we wire it up in Chunk 5.

### Task 6: MarketingFooter

**Files:**
- Create: `app/how-it-works/_components/MarketingFooter.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/MarketingFooter.tsx
import Link from 'next/link';

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 text-xs text-slate-500">
        <span>&copy; 2026 SAT Practice</span>
        <div className="flex items-center gap-4">
          <a href="#top" className="hover:text-slate-700">Back to top</a>
          <Link href="/login" className="hover:text-slate-700">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}
```

### Task 7: AnchorNav

**Files:**
- Create: `app/how-it-works/_components/AnchorNav.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/AnchorNav.tsx
//
// Non-sticky inline anchor links so parents can jump straight to the
// methodology / FAQ sections. Sticky-on-scroll behavior is explicitly
// deferred (see spec non-goals).
export function AnchorNav() {
  return (
    <nav className="mx-auto max-w-5xl px-6 pt-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        <li><a href="#how-it-works" className="hover:text-blue-600">How it works</a></li>
        <li><a href="#why-its-close" className="hover:text-blue-600">Why it&apos;s close to the real SAT</a></li>
        <li><a href="#methodology" className="hover:text-blue-600">How questions are made</a></li>
        <li><a href="#pool" className="hover:text-blue-600">Live pool</a></li>
        <li><a href="#faq" className="hover:text-blue-600">FAQ</a></li>
      </ul>
    </nav>
  );
}
```

### Task 8: Hero

**Files:**
- Create: `app/how-it-works/_components/Hero.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/Hero.tsx
import Link from 'next/link';
import type { PublicPoolStats } from '@/app/lib/marketing/queries';

interface HeroProps {
  stats: PublicPoolStats | null;
}

export function Hero({ stats }: HeroProps) {
  return (
    <section id="top" className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
        Digital SAT practice, built around how the real test actually works.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">
        Adaptive modules, every skill the College Board tests, and a fresh
        question every time.
      </p>

      {stats && (
        <p className="mt-6 text-sm text-slate-500">
          <span className="font-semibold text-slate-900">{stats.totalEnabled}</span> questions
          {' · '}
          <span className="font-semibold text-slate-900">{stats.skillCount}</span> skills
          {' · '}
          refreshed hourly
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/register"
          className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Start practicing
        </Link>
        <Link
          href="/login"
          className="rounded-md px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}
```

### Task 9: WhatYouGet

**Files:**
- Create: `app/how-it-works/_components/WhatYouGet.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/WhatYouGet.tsx
const CARDS = [
  {
    title: 'A real Digital SAT structure',
    body: 'Module 1 then Module 2 (Easier or Harder), section split, timed — the same shape as the real test.',
  },
  {
    title: 'Questions you haven’t seen',
    body: 'Per-student no-repeat. The pool grows every hour, so every session brings fresh material.',
  },
  {
    title: 'Explanations, not just answers',
    body: 'Every question has a plain-text rationale. Review your attempt after each test to see what you missed.',
  },
];

export function WhatYouGet() {
  return (
    <section className="bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-900">What you get</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {CARDS.map((c) => (
            <div key={c.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="text-base font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

### Task 10: HowItWorks (subway map)

**Files:**
- Create: `app/how-it-works/_components/HowItWorks.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/HowItWorks.tsx
const STEPS = [
  { n: 1, title: 'Sign up', body: 'Free, email or Google.' },
  { n: 2, title: 'Take a practice', body: 'Same module / timing structure as the real Digital SAT.' },
  { n: 3, title: 'Review', body: 'Correct answer, your answer, plain-text explanation.' },
  { n: 4, title: 'Track progress', body: 'Per-skill accuracy, score trend, focus areas.' },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-bold text-slate-900">How it works</h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-4">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-lg border border-slate-200 p-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {s.n}
            </div>
            <h3 className="mt-3 text-base font-semibold text-slate-900">{s.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

### Task 11: Parity

**Files:**
- Create: `app/how-it-works/_components/Parity.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/Parity.tsx
const CLAIMS = [
  {
    title: 'Two-module adaptive structure',
    body: 'Module 2 routes Easier or Harder based on Module 1 performance — same routing logic as the real Digital SAT.',
  },
  {
    title: 'All 35 College Board skills',
    body: '14 Reading & Writing skills and 21 Math skills, matching the official Digital SAT skill taxonomy.',
  },
  {
    title: 'Three difficulty tiers',
    body: 'Easy, Medium, Hard — used by the adaptive engine to choose Module 2.',
  },
  {
    title: 'Section weighting matches',
    body: 'Reading & Writing and Math question counts mirror real Digital SAT distributions.',
  },
  {
    title: 'Fresh content per student',
    body: 'Questions you’ve already attempted are never re-served. The pool is refilled hourly.',
  },
  {
    title: 'Honest about what’s different',
    body: 'We don’t reproduce the official Bluebook tools, and our scoring scale is approximate, not official.',
  },
];

export function Parity() {
  return (
    <section id="why-its-close" className="bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-900">Why it&apos;s close to the real Digital SAT</h2>
        <ul className="mt-8 space-y-4">
          {CLAIMS.map((c) => (
            <li key={c.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="text-base font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

### Task 12: QuestionPipeline (methodology + flow diagram)

**Files:**
- Create: `app/how-it-works/_components/QuestionPipeline.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/QuestionPipeline.tsx
//
// Methodology section. CSS-only "flow diagram" — 5 pills connected by
// chevrons. Validates that the implementation claim ("two independent
// models must agree") matches the live generator pipeline before this
// page ships — see spec implementation note.
const STAGES = ['Generate', 'Self-verify', 'Cross-model agreement', 'Multi-validity check', 'Insert into pool'];

export function QuestionPipeline() {
  return (
    <section id="methodology" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-bold text-slate-900">How questions are made</h2>

      <div className="mt-6 space-y-4 text-slate-700">
        <p>
          Every question is AI-generated, then cross-verified by a second AI
          model before it&apos;s served. We&apos;re upfront about this — and
          we put serious guardrails in place to keep quality high.
        </p>
        <p>
          The pipeline runs four validation stages before a candidate makes
          it into the pool. Two independent models must agree on the answer
          before the question is accepted. If they disagree, a third model
          breaks the tie. The candidate is then checked for choice-list
          issues (e.g. multiple valid answers) before insertion.
        </p>
        <p>
          You can flag any question while reviewing your attempt. Flagged
          questions go to an admin review queue and are disabled if they
          turn out to be incorrect or ambiguous.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center">
            <span className="rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-blue-200">
              {s}
            </span>
            {i < STAGES.length - 1 && (
              <span aria-hidden className="mx-1 text-slate-300">&rarr;</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
```

### Task 13: PoolComposition (live numbers)

**Files:**
- Create: `app/how-it-works/_components/PoolComposition.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/PoolComposition.tsx
import type { PublicPoolStats } from '@/app/lib/marketing/queries';

interface PoolCompositionProps {
  stats: PublicPoolStats | null;
}

type Section = 'rw' | 'math';
type Difficulty = 'easy' | 'medium' | 'hard';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'rw', label: 'Reading & Writing' },
  { key: 'math', label: 'Math' },
];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function PoolComposition({ stats }: PoolCompositionProps) {
  // Build a lookup keyed by 'section|difficulty' so missing cells default to 0.
  const cellLookup = new Map<string, number>();
  if (stats) {
    for (const c of stats.cells) {
      cellLookup.set(`${c.section}|${c.difficulty}`, c.count);
    }
  }

  return (
    <section id="pool" className="bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-900">Live pool composition</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          These numbers update as the generator runs (hourly). What you see is
          what new sessions draw from.
        </p>

        {stats ? (
          <>
            <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Section</th>
                    {DIFFICULTIES.map((d) => (
                      <th key={d} className="px-4 py-2 text-right capitalize">{d}</th>
                    ))}
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {SECTIONS.map((s) => {
                    const rowTotal = s.key === 'rw' ? stats.rwCount : stats.mathCount;
                    return (
                      <tr key={s.key} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{s.label}</td>
                        {DIFFICULTIES.map((d) => (
                          <td key={d} className="px-4 py-2 text-right font-mono tabular-nums text-slate-700">
                            {cellLookup.get(`${s.key}|${d}`) ?? 0}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold">{rowTotal}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="px-4 py-2 text-xs uppercase tracking-wide text-slate-500">Total by difficulty</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{stats.easyCount}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{stats.mediumCount}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{stats.hardCount}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold">{stats.totalEnabled}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Last refreshed: {formatTimestamp(stats.lastRefreshed)}.
            </p>
          </>
        ) : (
          <p className="mt-6 text-sm text-slate-500">
            Pool stats temporarily unavailable.
          </p>
        )}
      </div>
    </section>
  );
}
```

> The component reads from `stats.cells` (the cross-tab array from the RPC). Cells with zero enabled questions may be missing from the array, so we use a `Map` lookup with `?? 0` default — mirrors the same pattern used in `/admin/pool` for `generator_state` consumption.

### Task 14: FaqAccordion

**Files:**
- Create: `app/how-it-works/_components/FaqAccordion.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/FaqAccordion.tsx
//
// Native <details>/<summary> accordion. No React state, no client-side JS.
// Keeps the page server-only and accessible by default.

const FAQS = [
  {
    q: 'Is this free?',
    a: 'Yes. Sign up with email or Google and start practicing.',
  },
  {
    q: 'Are the questions written by AI?',
    a: 'Yes. Every question is AI-generated and cross-verified by a second AI model before it’s served. See "How questions are made" above for the full validation pipeline.',
  },
  {
    q: 'How is this different from official Bluebook practice?',
    a: 'We mirror the structure of the real Digital SAT (modules, timing, skill mix) but not the look. Our practice is free, unlimited, and the question pool refreshes hourly.',
  },
  {
    q: 'Will I get the same question twice?',
    a: 'No. We track every question you’ve attempted and skip it the next time around. Per-student no-repeat is enforced server-side.',
  },
  {
    q: 'What happens to questions I flag?',
    a: 'Flags go to an admin review queue. If the question is confirmed incorrect or ambiguous, an admin disables it and it’s never served again.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. Only your account sees your attempt history and analytics. Aggregate pool numbers on this page are public, but per-user data is not.',
  },
  {
    q: 'How accurate is the difficulty rating?',
    a: 'Every question is classified Easy / Medium / Hard at generation time. Admins periodically review and reclassify questions as needed.',
  },
  {
    q: 'Can I use this on mobile?',
    a: 'The practice flow works on phones and tablets, though larger screens give a more comfortable test-day feel.',
  },
];

export function FaqAccordion() {
  return (
    <section id="faq" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-bold text-slate-900">Frequently asked questions</h2>
      <div className="mt-8 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {FAQS.map((f) => (
          <details key={f.q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center justify-between text-base font-medium text-slate-900">
              <span>{f.q}</span>
              <span aria-hidden className="ml-4 text-slate-400 transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm text-slate-600">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
```

### Task 15: CtaFooter

**Files:**
- Create: `app/how-it-works/_components/CtaFooter.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/how-it-works/_components/CtaFooter.tsx
import Link from 'next/link';

export function CtaFooter() {
  return (
    <section className="bg-blue-600">
      <div className="mx-auto max-w-5xl px-6 py-12 text-center">
        <h2 className="text-2xl font-bold text-white">Ready to practice?</h2>
        <p className="mt-2 text-sm text-blue-100">
          Free to start. No credit card required.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            Start free
          </Link>
          <Link href="/login" className="text-sm text-blue-100 hover:text-white">
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Type-check all new components**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. None of the components are wired into the page yet (we do that in Chunk 5), but each must type-check independently.

- [ ] **Step 3: Commit**

```bash
git add app/how-it-works/_components/
git commit -m "feat(how-it-works): section components

MarketingHeader, MarketingFooter, AnchorNav, Hero, WhatYouGet, HowItWorks,
Parity, QuestionPipeline, PoolComposition, FaqAccordion, CtaFooter. All
presentational, no client state. FAQ uses native <details>; PoolComposition
renders dashes in inner cells (RPC returns section and difficulty totals
but not the cross-tab — fine for v1)."
```

---

## Chunk 5: Assemble the page + login/register links

### Task 16: Compose the full page

**Files:**
- Modify: `app/how-it-works/page.tsx`

- [ ] **Step 1: Replace the scaffold with the full composition**

```typescript
// app/how-it-works/page.tsx
//
// Public-facing explainer. Single fetch site for live pool numbers; sections
// receive stats as props (Hero, PoolComposition). All other sections are
// content-only.
//
// ISR: revalidate=3600. The page HTML is regenerated at most once an hour.
// If the RPC fails the page still renders — Hero hides the stat strip,
// PoolComposition shows a "temporarily unavailable" fallback.

import { getPublicPoolStats } from '@/app/lib/marketing/queries';
import { MarketingHeader } from './_components/MarketingHeader';
import { MarketingFooter } from './_components/MarketingFooter';
import { AnchorNav } from './_components/AnchorNav';
import { Hero } from './_components/Hero';
import { WhatYouGet } from './_components/WhatYouGet';
import { HowItWorks } from './_components/HowItWorks';
import { Parity } from './_components/Parity';
import { QuestionPipeline } from './_components/QuestionPipeline';
import { PoolComposition } from './_components/PoolComposition';
import { FaqAccordion } from './_components/FaqAccordion';
import { CtaFooter } from './_components/CtaFooter';

export const revalidate = 3600;

export const metadata = {
  title: 'How it works — SAT Practice',
  description:
    'Adaptive Digital SAT practice. Every College Board skill, fresh questions, with explanations.',
};

export default async function HowItWorksPage() {
  const stats = await getPublicPoolStats();

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <AnchorNav />
      <Hero stats={stats} />
      <WhatYouGet />
      <HowItWorks />
      <Parity />
      <QuestionPipeline />
      <PoolComposition stats={stats} />
      <FaqAccordion />
      <CtaFooter />
      <MarketingFooter />
    </div>
  );
}
```

- [ ] **Step 2: Smoke-check in the dev server**

```bash
pnpm dev
```

Open `http://localhost:3000/how-it-works` and verify:
- Hero shows total + skill count.
- All 8 content sections render in order.
- Anchor links jump correctly (`#how-it-works`, `#why-its-close`, `#methodology`, `#pool`, `#faq`).
- FAQ items expand/collapse on click.
- "Start practicing" links to `/register`.
- "Sign in" links to `/login`.

Stop the dev server.

- [ ] **Step 3: Type-check, lint, build**

```bash
pnpm exec tsc --noEmit
pnpm next lint
pnpm build
```

Expected: all pass. The build output should show `/how-it-works` listed as an ISR route.

- [ ] **Step 4: Commit**

```bash
git add app/how-it-works/page.tsx
git commit -m "feat(how-it-works): assemble full page

Single fetch site for live stats; sections receive stats as props where
they need them. Adds page <title> and meta description."
```

### Task 17: Link from /login

**Files:**
- Modify: `app/(auth)/login/page.tsx`

- [ ] **Step 1: Read the existing login page**

Open `app/(auth)/login/page.tsx`. Find the bottom of the form / page (likely just above the closing tag for the main container).

- [ ] **Step 2: Add a footer link**

Add this immediately above the last closing tag of the main content container:

```tsx
<p className="mt-6 text-center text-xs text-slate-500">
  New here?{' '}
  <Link href="/how-it-works" className="text-blue-600 hover:underline">
    See how it works
  </Link>
</p>
```

If `Link` isn't already imported at the top of the file, add:

```tsx
import Link from 'next/link';
```

- [ ] **Step 3: Verify in browser**

```bash
pnpm dev
```

Visit `http://localhost:3000/login`. The "See how it works" link should appear below the form. Clicking it navigates to `/how-it-works`. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/(auth)/login/page.tsx
git commit -m "feat(auth): link to /how-it-works from login

Small text link below the form: 'New here? See how it works'."
```

### Task 18: Link from /register

**Files:**
- Modify: `app/(auth)/register/page.tsx`

- [ ] **Step 1: Repeat Task 17 for `/register`**

Add the same link block immediately above the closing tag of the register page's main content container. Add the `Link` import if missing.

- [ ] **Step 2: Verify in browser, commit**

```bash
pnpm dev
# verify the link appears on /register
```

```bash
git add app/(auth)/register/page.tsx
git commit -m "feat(auth): link to /how-it-works from register"
```

---

## Chunk 6: Final verification

### Task 19: Full sweep

- [ ] **Step 1: Type check**

```bash
pnpm exec tsc --noEmit
```

Expected: no output (no errors).

- [ ] **Step 2: Lint**

```bash
pnpm next lint
```

Expected: `✔ No ESLint warnings or errors`. Pay special attention to `react/no-unescaped-entities` — apostrophes in JSX text are the most common gotcha (we hit this earlier in the session). All literal apostrophes in section components must use `&apos;` or `’`; literal `"` must use `&quot;` / `&ldquo;` / `&rdquo;`. The provided code already escapes them, but verify after any copy edit.

- [ ] **Step 3: Production build**

```bash
pnpm build
```

Expected: build succeeds. `/how-it-works` should appear in the build output, ideally as `⊕ (Incremental)` since `revalidate = 3600` is set. If it appears as `λ (Dynamic)`, something inadvertently forced dynamic rendering — most likely a cookie read. Check `getPublicPoolStats` is using the plain anon client (not `createServerClient` from `app/lib/supabase/server.ts`).

- [ ] **Step 4: Manual browser smoke check**

```bash
pnpm dev
```

In a browser:

| Check | Expected |
|---|---|
| Visit `/how-it-works` while signed OUT | Page renders, no redirect to `/login` |
| Visit `/how-it-works` while signed IN | Page renders, no redirect to `/dashboard` |
| All 8 sections render top to bottom | Hero, WhatYouGet, HowItWorks, Parity, QuestionPipeline, PoolComposition, FaqAccordion, CtaFooter |
| Live stat strip in Hero | Shows `<totalEnabled>` and `<skillCount>` with current values |
| Pool composition table | Shows current R&W / Math totals, E/M/H totals, and last-refreshed timestamp |
| Anchor links | Each link in AnchorNav scrolls to the corresponding section |
| FAQ accordion | Each item expands/collapses on click without JS errors |
| Hero "Start practicing" button | Navigates to `/register` |
| Hero "Sign in" button | Navigates to `/login` |
| Footer "Sign in" link | Navigates to `/login` |
| CtaFooter "Start free" button | Navigates to `/register` |
| Footer "Back to top" link | Scrolls to top of page |
| `/login` footer link | Shows "New here? See how it works" linking to `/how-it-works` |
| `/register` footer link | Same as above |

Stop the dev server.

- [ ] **Step 5: RPC isolation check (manual SQL)**

In the Supabase SQL editor or via `mcp__claude_ai_Supabase__execute_sql`, run:

```sql
-- Confirm the RPC works as anon and does NOT leak per-skill detail
set role anon;
select jsonb_object_keys(sat.public_pool_stats()) order by 1;
reset role;
```

Expected keys (sorted): `asOf`, `easyCount`, `hardCount`, `lastRefreshed`, `mathCount`, `mediumCount`, `rwCount`, `skillCount`, `totalEnabled`.

Expected NOT present: `minActiveUserUnseen`, `worstStudentUnseen`, `cells`, `skills`, `neverServedFloor`.

- [ ] **Step 6: Final push**

```bash
git push origin main
```

Confirm the Vercel deployment goes green. Once deployed, repeat the browser smoke check on the production URL.

---

## Out of scope (deferred to follow-ups)

- SEO/OG metadata polish (just title + description in v1).
- Sticky in-page nav.
- Dark mode for the marketing page.
- Per-cell pool numbers in the composition grid — would need RPC extension to also return a `cells` array.
- A separate `/about` parent route or sibling pages.
- Authenticated-app navigation entry point (no link from AppHeader in v1).
