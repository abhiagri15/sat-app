# Public "How it works" Page — Design

**Status:** Draft (spec review pending)
**Author:** Brainstorming session, 2026-05-26
**Slug:** `how-it-works-page`

## Goal

Add a public-facing explainer page at `/how-it-works` that:

1. Explains how the SAT practice app works for students and parents in a single scrolling page.
2. Documents the AI-generated question pipeline and validation, building trust through transparency.
3. Surfaces live pool numbers (total questions, per-section / per-difficulty composition, last refresh) so the claims are verifiable, not marketing.
4. Lives outside the auth wall — anonymous visitors must be able to read it.

## Non-goals

- Marketing landing page that replaces `/`.
- SEO/OG metadata polish (deferred).
- Sticky in-page nav, dark mode, parent-only deep-dive page (deferred).
- Multiple "About" sub-routes (`/about/faq`, `/about/privacy` etc.) — only justified if more public pages are planned later.

## Audience

Single page, two audiences. Content flows top-to-bottom from student-facing value ("what you get") into shared mechanics ("how it works") into parent-facing methodology ("how questions are made"). Anchor nav at the top lets parents jump straight to the methodology block.

## Architecture

### Route & middleware

- New route file: `app/how-it-works/page.tsx`. Sits outside both `(app)` and `(auth)` route groups so it does not inherit auth-gated layouts or auth-styled headers.
- Middleware change: add `/how-it-works` to `PUBLIC_PATHS` in `middleware.ts`. Unauthenticated visitors can read it; authenticated visitors can too (no redirect to `/dashboard`).
- The page provides its own minimal header (logo + "Sign in" / "Try it" CTAs) and footer. No reuse of `AppHeader`.

### Rendering mode

- Server component with `export const revalidate = 3600` (Next.js ISR — page is regenerated at most once per hour).
- Trade-off: live numbers may lag visits by up to 60 min. Acceptable for an explainer page; no one reloads twice in an hour.
- If strictly current numbers are ever required, switch to `dynamic = 'force-dynamic'` and accept the per-visit DB hit.

## Live-data plumbing

### Problem

The existing `sat.generator_state()` RPC is `security definer` and granted only to `authenticated` and `service_role`. The "How it works" page is public — anonymous visitors must see numbers. We cannot call `generator_state()` from an anon browser context, and we should not, because it exposes operational metrics (per-skill `worstStudentUnseen`, `minActiveUserUnseen`) that leak how many students are active.

### Solution: a new sanitized RPC `sat.public_pool_stats()`

```sql
-- supabase/migrations/<TS>_sat_public_pool_stats.sql
--
-- Returns only aggregate, non-sensitive pool numbers. Safe for anonymous callers.
-- No per-skill detail, no worst-student data, no admin config — just headline pool
-- composition that a marketing page can quote.

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
    'lastRefreshed', (select max(created_at) from sat.questions where source = 'ai'),
    'asOf',          now()
  );
$$;

grant execute on function sat.public_pool_stats() to anon, authenticated, service_role;
```

### TypeScript boundary

- New file: `app/lib/marketing/queries.ts`
- Exports `PublicPoolStats` type and `getPublicPoolStats(): Promise<PublicPoolStats | null>`.
- Calls the RPC via the **anon** Supabase client (not service-role) — this proves the access path works for unauthenticated visitors.
- On any error, logs to `console.error` and returns `null`.

### Caching

Three layers stack naturally:
- Postgres function: tens of milliseconds.
- Next.js ISR: HTML cached for 1 hour (`revalidate = 3600`).
- No application-level cache needed.

## Content sections

Anchor-linked single scroll. Each block below has heading, intent, and structure. Final copy is finalized during implementation.

### 1. Hero

- Heading: "Digital SAT practice, built around how the real test actually works."
- Subhead: one sentence — "Adaptive modules, every skill the College Board tests, and a fresh question every time."
- Live stat strip: `{totalEnabled} questions · {skillCount} skills · refreshed hourly`
- Two CTAs: primary "Start practicing" → `/register`, secondary "Sign in" → `/login`

### 2. What you get (3-card row)

- Card 1: *A real Digital SAT structure* — Module 1 → Module 2 (Easier or Harder), section split, timed.
- Card 2: *Questions you've never seen* — per-student no-repeat; the pool grows every hour.
- Card 3: *Explanations, not just answers* — every question has a plain-text rationale; review your attempt after each test.

### 3. How it works (4-step subway map)

1. Sign up — free, email or Google.
2. Take a practice — same module / timing structure as the real Digital SAT.
3. Review — correct answer, your answer, plain-text explanation.
4. Track progress — per-skill accuracy, score trend, weak-area focus list.

### 4. Why it's close to the real Digital SAT

Bulleted parity claims, each backed by a concrete fact:

- **Two-module adaptive structure** — Module 2 routes Easier / Harder based on Module 1 performance (admin-tunable threshold).
- **All 35 College Board skills** — 14 R&W + 21 Math.
- **Three difficulty tiers** — Easy / Medium / Hard, used by the adaptive engine for Module 2.
- **Section weighting matches** — R&W and Math counts in line with real Digital SAT distributions.
- **Fresh content** — never re-served per student; the pool is refilled hourly.
- **Honest about what's different** — no official Bluebook tools; scoring is approximate, not official.

### 5. How questions are made (transparency)

Plain-language explanation, ~3 paragraphs plus a small horizontal flow diagram.

- Opening line: "Every question is AI-generated, then cross-verified by a second AI model before it's served."
- The pipeline as a flow: **Generate** → **Self-verify** → **Cross-model agreement** → **Multi-validity check** → **Insert into pool**.
- Names validation gates **without naming the underlying models**. ("Two independent models must agree on the answer.")
- Acknowledges the flag flow: users can flag bad questions; admins review and disable.

### 6. Live pool composition

- A 2×3 grid: rows R&W / Math, columns Easy / Medium / Hard, cell shows count.
- Total below the grid.
- "Last refreshed: `{lastRefreshed}`" timestamp.
- Caption: "These numbers update as the generator runs (hourly)."

### 7. FAQ (accordion, 6-8 items)

- Is this free?
- Are the questions written by AI?
- How is this different from official Bluebook practice?
- Will I get the same question twice?
- What happens to questions I flag?
- Is my data private?
- How accurate is the difficulty rating?
- Can I use this on mobile?

### 8. CTA footer

- "Ready to practice?" → big "Start free" → `/register`.
- Small print: "Already have an account? Sign in." → `/login`.

## Judgment calls (explicit decisions)

- **Do not name AI models** (e.g. `deepseek-v4-pro`, `gemini-3-flash-preview`) in section 5. Adds zero credibility for non-technical readers and locks copy to today's stack.
- **Show pool composition even when uneven.** Transparency hinges on real numbers. If the numbers embarrass us on a given day, fix the pool, don't hide the page.

## Error handling

`getPublicPoolStats()` wraps the RPC in `try/catch`; on any error logs to `console.error` and returns `null`. The page renders three states for the stats block:

| State | Behavior |
|---|---|
| Success | Render numbers + last-refreshed timestamp. |
| `null` (RPC error) | Single neutral line: "Pool stats temporarily unavailable." Rest of the page renders normally. |
| Zero results (pool empty edge case) | Render grid with zeros. Nothing breaks. |

The hero stat strip degrades the same way: if `stats === null`, the strip omits the count.

ISR `revalidate = 3600` means transient failures self-heal on the next cache miss.

## Link integration

- **From `/login`**: footer link — "New here? See how it works" → `/how-it-works`. Same on `/register`.
- **From the page**: hero CTAs and bottom CTA strip both link to `/register`; secondary "Sign in" → `/login`.
- **From the authenticated app**: no link in v1.

## File inventory

New files:

- `supabase/migrations/<TS>_sat_public_pool_stats.sql`
- `app/lib/marketing/queries.ts`
- `app/how-it-works/page.tsx`
- `app/how-it-works/_components/Hero.tsx`
- `app/how-it-works/_components/WhatYouGet.tsx`
- `app/how-it-works/_components/HowItWorks.tsx`
- `app/how-it-works/_components/Parity.tsx`
- `app/how-it-works/_components/QuestionPipeline.tsx`
- `app/how-it-works/_components/PoolComposition.tsx`
- `app/how-it-works/_components/FaqAccordion.tsx`
- `app/how-it-works/_components/CtaFooter.tsx`
- `app/how-it-works/_components/MarketingHeader.tsx`
- `app/how-it-works/_components/MarketingFooter.tsx`

Modified files:

- `middleware.ts` — add `/how-it-works` to `PUBLIC_PATHS`.
- `app/(auth)/login/page.tsx` — add "How it works" footer link.
- `app/(auth)/register/page.tsx` — add "How it works" footer link.

The `_components` folder uses the underscore prefix so Next.js does not treat them as routes. Each component is small, scoped to a single section, and consumes only the props it needs — keeps each unit understandable in isolation.

## Testing

Light-touch, manual-first. No new automated test files.

1. **Type check + lint:** `pnpm exec tsc --noEmit` and `pnpm next lint` pass.
2. **Build:** `pnpm build` succeeds (catches ISR / route-config errors).
3. **Manual smoke check (browser):**
   - Visit `/how-it-works` while signed OUT → page renders, no redirect to `/login`.
   - Visit `/how-it-works` while signed IN → page renders, no redirect to `/dashboard`.
   - Disable network / break the RPC → fallback copy appears, no crash.
   - Click "Start practicing" → lands on `/register`.
4. **RPC isolation check (one-time, manual SQL):**
   - Call `sat.public_pool_stats()` from the SQL editor as `anon` role → returns JSON, no permission error.
   - Confirm it does NOT leak per-skill detail (`worstStudentUnseen` absent).

## Migration sequencing

1. Apply migration `<TS>_sat_public_pool_stats.sql` first (independent of UI work; safe even if no page exists yet).
2. Land the page + middleware changes in a single commit (they ship together).
3. Land the login/register footer links in a follow-up commit (smallest blast radius).

## Open questions

- Final copy wording — finalized during implementation, not now.
- Whether the Math hard tier being thin is something we acknowledge explicitly in the FAQ ("we're still expanding the hardest math content") or just leave the live numbers to speak. Defer until implementation.
