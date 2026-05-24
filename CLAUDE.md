# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # first-time setup
pnpm dev              # next dev — http://localhost:3000
pnpm build            # production build
pnpm start            # serve the production build
pnpm lint             # next lint (uses Next.js defaults)
pnpm type-check       # tsc --noEmit
```

There is no unit-test runner in this project. The pure modules that warrant checking are
exercised by scripted assertion files:

```bash
pnpm dlx tsx scripts/check-payload.ts     # builds a test, maps it, asserts the payload shape
pnpm dlx tsx scripts/check-analytics.ts   # asserts the analytics compute helpers
```

## Architecture

Next.js 15 **App Router**, TypeScript, React 19. The app is decomposed into focused modules.

- [app/(app)/page.tsx](app/(app)/page.tsx) — server entry (authenticated), reads the profile, renders `<SatPractice studentName={...} />`.
- [app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx) — dashboard; server component, lists the signed-in user's past attempts (newest first) via `listAttempts()`.
- [app/(app)/dashboard/attempts/[id]/page.tsx](app/(app)/dashboard/attempts/[id]/page.tsx) — read-only review of one attempt via `getAttempt(id)`; `notFound()` if the id is missing or not the user's.
- [app/(app)/analytics/page.tsx](app/(app)/analytics/page.tsx) — analytics page; server component, calls `getAnalytics()` and renders summary stats, score trend, section/skill accuracy, and a focus-areas callout. Empty state when `summary.testsTaken === 0`.
- [app/(app)/admin/layout.tsx](app/(app)/admin/layout.tsx) — gates the whole `/admin` subtree (`await requireAdmin()` 404s non-admins) and renders `<AdminNav />` above the page so the sub-menu is on every admin route.
- [app/(app)/admin/page.tsx](app/(app)/admin/page.tsx) — admin **Overview** dashboard; server component, four cards summarising each section (question pool counts, user counts, open flags, daily attempt limit) with links into them. The pool listing used to live here; it now lives at `/admin/questions`.
- [app/(app)/admin/questions/page.tsx](app/(app)/admin/questions/page.tsx) — question pool listing (moved from `/admin`); server component, shows pool counts, section/status filters, and a list of `QuestionRow`s.
- [app/(app)/admin/questions/[id]/page.tsx](app/(app)/admin/questions/[id]/page.tsx) — full question detail (passage, choices with the correct answer marked, explanation, metadata) + enable/disable toggle; `notFound()` for a missing id.
- [app/(app)/admin/users/page.tsx](app/(app)/admin/users/page.tsx) — admin users listing; server component, `listUsersWithStats()` then a `UserRow` per user (tests-taken, avg score, last activity), most-recently-active first.
- [app/(app)/admin/users/[id]/page.tsx](app/(app)/admin/users/[id]/page.tsx) — per-user analytics drill-through; same shape as `/analytics` (score trend, section/skill accuracy, focus areas) but for the selected user via `getUserAnalyticsForAdmin(id)`. Reuses `ScoreTrend`, `SkillAccuracy`, and the compute helpers as-is.
- [app/(app)/admin/flags/page.tsx](app/(app)/admin/flags/page.tsx) — admin question-flags review page; server component, `listFlags(status)` with an open/resolved/all filter, renders a list of `FlagRow`s.
- [app/(app)/admin/settings/page.tsx](app/(app)/admin/settings/page.tsx) — admin app-config page; currently exposes the daily test-attempt limit (see "Daily test limit" below).
- [app/components/admin/AdminNav.tsx](app/components/admin/AdminNav.tsx) — `'use client'` sub-menu (Overview · Question Pool · Users · Open Flags · Settings) rendered by the admin layout. Active-tab highlighting via `usePathname()`; detail routes (e.g. `/admin/users/<id>`) keep their parent tab lit.
- [app/components/admin/QuestionRow.tsx](app/components/admin/QuestionRow.tsx) — one pool row: metadata, truncated prompt, and a `setQuestionEnabled`-bound enable/disable form.
- [app/components/admin/UserRow.tsx](app/components/admin/UserRow.tsx) — one user row on `/admin/users`: name (with fallback full_name → email → `User <id-prefix>`), admin badge if applicable, stats inline.
- [app/components/admin/FlagRow.tsx](app/components/admin/FlagRow.tsx) — one flag row: reason badge, truncated/linked question prompt, optional comment, and a `resolveFlag`-bound mark-resolved form for open flags.
- [app/components/FlagQuestion.tsx](app/components/FlagQuestion.tsx) — `'use client'` in-review widget: a reason picker + optional comment that files a flag via `submitFlag`. Rendered inside `ReviewItem`.
- [app/lib/admin/guard.ts](app/lib/admin/guard.ts) — `requireAdmin()`: returns the signed-in admin's profile or `notFound()`s. Shared by the `/admin` layout and every admin server action.
- [app/lib/admin/queries.ts](app/lib/admin/queries.ts) — `listQuestions()` / `getQuestion()` / `getPoolCounts()`: read `sat.questions` for the admin pool views.
- [app/lib/admin/actions.ts](app/lib/admin/actions.ts) — `'use server'` `setQuestionEnabled()` / `resolveFlag()`: each re-checks `requireAdmin()`, then writes via the service-role client (soft-enable/disable a question, or mark a flag resolved).
- [app/lib/admin/flags.ts](app/lib/admin/flags.ts) — `listFlags()` / `countOpenFlags()`: read `sat.question_flags` via the service-role client for the admin review (the table has no RLS policy).
- [app/lib/admin/users.ts](app/lib/admin/users.ts) — `listUsersWithStats()` / `getUserProfileForAdmin(id)` / `getUserAnalyticsForAdmin(id)`: power the `/admin/users` views. The two aggregations are security-definer RPCs (`sat.admin_users_summary`, `sat.admin_user_analytics`) that re-check `role = 'admin'` at the SQL layer; the single-row profile lookup uses the service-role client. Mirrors the `AnalyticsView` shape from `analytics/compute.ts` so the existing chart components render unchanged.
- [app/lib/feedback/actions.ts](app/lib/feedback/actions.ts) — `'use server'` `submitFlag()`: a signed-in user files a question flag through the `sat.submit_flag` security-definer RPC.
- [app/(auth)/login/page.tsx](app/(auth)/login/page.tsx) — email/password sign-in + Google OAuth button.
- [app/(auth)/register/page.tsx](app/(auth)/register/page.tsx) — account creation.
- [app/(auth)/forgot-password/page.tsx](app/(auth)/forgot-password/page.tsx) — password-reset request.
- [app/(auth)/reset-password/page.tsx](app/(auth)/reset-password/page.tsx) — new-password form.
- [app/auth/callback/route.ts](app/auth/callback/route.ts) — exchanges the OAuth/email-link `code` for a session; redirects into the app.
- [middleware.ts](middleware.ts) — refreshes the Supabase session cookie every request; redirects unauthenticated traffic to `/login`. Public paths: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`.
- [app/components/AppHeader.tsx](app/components/AppHeader.tsx) — server component; shows title, `/dashboard` and `/analytics` links, an `/admin` link for admins only, user display name, and a Sign out button.
- [app/lib/auth/schemas.ts](app/lib/auth/schemas.ts) — zod schemas for the four auth forms (`loginSchema`, `registerSchema`, `forgotPasswordSchema`, `resetPasswordSchema`).
- [app/lib/auth/actions.ts](app/lib/auth/actions.ts) — `'use server'` `signOut()` action: clears the session and redirects to `/login`.
- [app/lib/auth/profile.ts](app/lib/auth/profile.ts) — `getOrCreateProfile()`: React `cache()`-wrapped server helper; reads or lazily creates the signed-in user's `sat.profiles` row.
- [app/components/SatPractice.tsx](app/components/SatPractice.tsx) — `'use client'`. Thin FSM router: `'start' | 'test' | 'results'`. Accepts `studentName` prop; delegates all state to `useTestSession`.
- [app/hooks/useTestSession.ts](app/hooks/useTestSession.ts) — `'use client'` hook. Holds the timer (a `setInterval` ref restarted whenever `secIdx` changes), per-section `remaining[]` countdown, and `responses[secIdx][qIdx]` answer matrix. Accepts `initialName` to seed the `name` state from the profile.
- [app/lib/test.ts](app/lib/test.ts) — pure logic: `buildTest`, `computeResults`, `fmtTime`. No React dependencies.
- [app/lib/questions.ts](app/lib/questions.ts) — `BANK` array + `SECTION_CONFIG` (with `fullCount`) + `SECTION_ORDER` + `SKILLS` taxonomy. `BANK` is now the seed source and offline fallback; the runtime source is `sat.questions`.
- [app/lib/pool.ts](app/lib/pool.ts) — `'use client'`. `drawTestQuestions(testLength)`: calls the `draw_questions` RPC per section via the browser Supabase client and returns a `Question[]` for `useTestSession`.
- [app/lib/supabase/admin.ts](app/lib/supabase/admin.ts) — `createAdminClient()`. Service-role client. **SERVER ONLY.** Bypasses RLS. Never import from a `'use client'` module.
- [app/lib/ai/provider.ts](app/lib/ai/provider.ts) — `AIProvider` interface + `getProvider()` factory keyed on `SAT_AI_PROVIDER`.
- [app/lib/ai/ollama.ts](app/lib/ai/ollama.ts) — `OllamaCloudProvider`: calls Ollama Cloud's OpenAI-compatible chat endpoint (`{OLLAMA_BASE_URL}/v1/chat/completions`).
- [app/lib/ai/schema.ts](app/lib/ai/schema.ts) — zod schema for a generated question (`generatedQuestionSchema`).
- [app/lib/ai/dedup.ts](app/lib/ai/dedup.ts) — `dedupHash(prompt, choices, passage?)`: SHA-256 of normalized content; mirrors the `UNIQUE` constraint on `sat.questions.dedup_hash`.
- [app/lib/ai/generate.ts](app/lib/ai/generate.ts) — `runGeneration()`: demand-driven — counts never-attempted questions (enabled, no `served_questions` row) and is a no-op while that buffer is `>= BUFFER_TARGET` (100); otherwise generates a bounded batch for the thinnest `(section, skill)`, runs the quality gate (zod → self-verify → dedup), and inserts survivors via the service-role client.
- [app/api/admin/generate-questions/route.ts](app/api/admin/generate-questions/route.ts) — `GET` handler; secret-gated by `CRON_SECRET`; calls `runGeneration()` and returns a JSON summary. In `middleware.ts` `PUBLIC_PATHS` (not session-gated) but requires the bearer secret.
- [scripts/seed-questions.ts](scripts/seed-questions.ts) — one-time seed script: upserts `BANK` into `sat.questions` (`source='seed'`) via the service-role client. Run with `pnpm dlx tsx --env-file=.env.local scripts/seed-questions.ts`.
- [app/lib/persistence/payload.ts](app/lib/persistence/payload.ts) — `toAttemptPayload()`: pure mapper from a finished in-memory `Test` + responses + `Results` to the `save_attempt` payload. No I/O. Covered by `scripts/check-payload.ts`.
- [app/lib/persistence/actions.ts](app/lib/persistence/actions.ts) — `'use server'` `saveAttempt()` action: zod-validates the payload, then calls the `sat.save_attempt` RPC.
- [app/lib/persistence/queries.ts](app/lib/persistence/queries.ts) — `listAttempts()` / `getAttempt(id)`: read attempt history from `sat.test_attempts` / `sat.attempt_responses` (RLS-scoped to the user).
- [scripts/check-payload.ts](scripts/check-payload.ts) — scripted assertion file for `toAttemptPayload` (no unit-test runner). Run with `pnpm dlx tsx scripts/check-payload.ts`.
- [app/lib/analytics/compute.ts](app/lib/analytics/compute.ts) — pure analytics helpers: `accuracyPct`, `sortSkillsWeakestFirst`, `focusAreas`, `summarize`, plus the `SkillStat` / `SectionStat` / `TrendPoint` / `AnalyticsView` types. No I/O. Covered by `scripts/check-analytics.ts`.
- [app/lib/analytics/queries.ts](app/lib/analytics/queries.ts) — `getAnalytics()`: assembles the analytics view — per-skill/section aggregates from the `sat.user_analytics` RPC, score trend + summary from `listAttempts()`.
- [app/components/analytics/ScoreTrend.tsx](app/components/analytics/ScoreTrend.tsx) — plain (non-client) inline-SVG line chart of scaled score over attempts. No charting dependency.
- [app/components/analytics/SkillAccuracy.tsx](app/components/analytics/SkillAccuracy.tsx) — plain component: per-skill CSS accuracy bars grouped by section, weakest-first, colour-graded.
- [scripts/check-analytics.ts](scripts/check-analytics.ts) — scripted assertion file for the analytics compute helpers. Run with `pnpm dlx tsx scripts/check-analytics.ts`.
- [vercel.json](vercel.json) — Vercel Cron: `0 0 * * *` (daily) → `/api/admin/generate-questions`. Hobby plan caps cron at daily; on Pro, change to `0 * * * *` for hourly.

`buildTest()` in `app/lib/test.ts` is the test-construction pipeline: filters `BANK` by section, shuffles questions, shuffles each question's choices (remapping the stored `answerIndex` to the new position), and slices to `shortCount` for "Quick" or all questions for "Full". A fresh shuffle runs on every "Start a New Test" — there is no persistence (no localStorage, no backend).

Path alias `@/*` → `./*` (repo root) is configured in `tsconfig.json`; cross-directory imports use `@/app/...`, while within a directory relative imports are the convention.

## Auth gotchas

- **The `sat` schema MUST be exposed in Supabase API settings.** The app queries `sat.profiles` via `supabase.schema('sat').from('profiles')` (PostgREST). Supabase only exposes the `public` schema by default. If `sat` is not added to Settings → API → Exposed Schemas, every call to `getOrCreateProfile()` fails — every authenticated page will error. This is a one-time dashboard action on the Property Ledger project (`falgykkspbtrwdcchayi`).

- **`sat.profiles.role` is not user-writable — enforced by a trigger.** The migration uses column-scoped `GRANT`s, but Supabase re-grants table-level `INSERT`/`UPDATE` to `anon`/`authenticated` on tables in exposed schemas (its "grant broad, secure with RLS" model), and RLS only restricts *which rows* a user touches — not *which columns*. So the real guard is the `profiles_protect_role` BEFORE INSERT OR UPDATE trigger (`sat.protect_profile_role()`): for API roles (`anon`/`authenticated`) it forces `role` to `'student'` on insert and silently keeps the existing `role` on update — a user cannot escalate to `admin` via the API. Privileged roles (`postgres`/`service_role`) are unaffected. To promote a user to admin, run a direct `UPDATE` as the `postgres`/service role: `update sat.profiles set role = 'admin' where id = '<user-uuid>';` **If you add another privileged column to `sat.profiles`, extend that trigger.**

- **Profile rows are created by `getOrCreateProfile()`, NOT by a database trigger on `auth.users`.** The Property Ledger Supabase project is shared with the PropLedger app. An `on_auth_user_created` trigger on the shared `auth.users` table would fire for every PropLedger sign-up, creating junk `sat.profiles` rows. Application-code provisioning keeps the SAT app fully confined to the `sat` schema. `getOrCreateProfile()` is called on every authenticated entry point (`AppHeader`, `(app)/page.tsx`, `(app)/dashboard/page.tsx`), so the row is reliably created on first load regardless of sign-up method.

- **Middleware gates everything except `PUBLIC_PATHS`.** The public paths are: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`. Every other route requires a session — `middleware.ts` redirects unauthenticated requests to `/login`. If you add a new public route (e.g. a health-check endpoint), add it to `PUBLIC_PATHS` in `middleware.ts` or it will be gated.

## AI sub-project gotchas

- **`app/lib/supabase/admin.ts` is server-only.** It imports `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_`-prefixed). If you import `createAdminClient` into any `'use client'` module, Next.js will bundle the service-role key into the browser bundle — a critical secret leak. Only import it from route handlers, server actions, or other server-only files (`generate.ts`, `seed-questions.ts`). Verification command (run from the project root):
  ```powershell
  Get-ChildItem -Path app -Recurse -Include *.tsx,*.ts | Select-String -Pattern "supabase/admin|SUPABASE_SERVICE_ROLE_KEY"
  ```
  Expected: matches only in `app/lib/supabase/admin.ts` and `app/lib/ai/generate.ts` — never in a `'use client'` module.

- **`sat.questions` has only a `select` RLS policy — users cannot write to it.** The migration deliberately omits an insert/update/delete policy. Authenticated users can read the pool (for the RPC), but any direct write via the anon/authenticated role is denied by RLS. New questions are written exclusively by the generation endpoint via the service-role client (which bypasses RLS). The seed script likewise uses the service-role client.

- **`service_role` needed an explicit `USAGE` grant on the `sat` schema.** Foundation's `20260521000000_sat_schema.sql` granted `USAGE` on `sat` only to `anon` and `authenticated`. The service role's `BYPASSRLS` attribute bypasses row-level security but does NOT grant schema-level privileges — the service role was still blocked from writing `sat.questions`. Migration `20260521040000_sat_service_role_grants.sql` adds `GRANT USAGE ON SCHEMA sat TO service_role` plus full table/sequence privileges. If you add new tables to the `sat` schema that the service role must write, confirm the grants or re-run this migration.

- **`/api/admin/generate-questions` is in `PUBLIC_PATHS` but is secret-gated.** The route is excluded from the session middleware (it has no user session — it is called by Vercel Cron). It authenticates itself with `Authorization: Bearer <CRON_SECRET>` instead. A request without that header returns `401`. Do not add session gating to this route; do not remove it from `PUBLIC_PATHS`.

- **AI-generated explanations are rendered React-escaped — not via `dangerouslySetInnerHTML`.** `ReviewItem.tsx` branches on `question.source`: `'seed'` explanations use `dangerouslySetInnerHTML` (trusted, hand-authored, may contain `<b>` tags); all other sources (i.e. `'ai'`) render via `<span>{question.explanation}</span>` — React escapes the content. The Ollama prompt asks for plain-text explanations, so no formatting is lost. Do not widen `dangerouslySetInnerHTML` to AI-sourced questions.

- **`BANK` is now the seed source and offline fallback only.** The runtime question source is `sat.questions` (via the `draw_questions` RPC in `app/lib/pool.ts`). `useTestSession.start()` is async: it draws from the pool and falls back to `BANK` only if the draw throws or returns empty. Adding questions to `BANK` without re-running the seed script will not make them visible to users at runtime; update `sat.questions` directly, or extend the seed and re-run it.
- **Explanations must not reference choices by letter or number.** Because `buildTest()` shuffles choices per test, an explanation that says "Choice A is correct because..." becomes wrong at runtime if A is no longer the correct slot — the displayed "Correct answer: B" then disagrees with the explanation's text. The `ollama.ts` prompt forbids it, the n8n Plan Batches prompt forbids it, and the n8n Parse Candidates node has a `repairLetterRefs()` regex pass that rewrites surviving "Choice X" / "Option N" references before insert (correct-index → "the correct choice", incorrect-index → "another choice"). Don't add a feature that reintroduces letter references — write them as "the correct choice" or quote the option's content instead.
- **Cloze passages must contain `______` (six underscores); RC passages must not.** Completion-style skills (Boundaries, Form & Structure (Verbs), Pronoun/SV Agreement, Transitions, Words in Context) require a `______` marker at the insertion point. RC skills (Central Ideas, Command of Evidence) must be complete prose with no blank. The n8n Parse Candidates node enforces both directions: if a completion passage is missing the blank, `repairMissingBlank()` finds the correct choice's text inside the passage and replaces it with `______`; if an RC passage has a blank, `repairRcBlank()` replaces it with the correct choice's content. Candidates that can't be repaired are dropped.

## Persistence sub-project gotchas

- **`sat.test_attempts` and `sat.attempt_responses` are RLS select-only.** Each table has a `select` policy scoped to `auth.uid()` and *no* insert/update/delete policy — even though Supabase grants table privileges to `authenticated` on exposed-schema tables, RLS with no write policy denies all writes. The only writer is the `sat.save_attempt` security-definer RPC, which bypasses RLS and sets `user_id := auth.uid()` itself. This mirrors the `sat.questions` / `draw_questions` pattern. If you add a write path, go through a security-definer function — do not add a write policy.

- **`attempt_responses` rows snapshot the question as it was presented.** Each row stores the per-test-shuffled `choices`, the remapped `answer_index`, and the `explanation` — not a reference to the live `sat.questions` row. `buildTest()` shuffles each question's choices per test, so a stored `chosen_index` is meaningless against the original question's choice order. The review page (`/dashboard/attempts/[id]`) must read these snapshotted columns; never re-join to `sat.questions` to "freshen" a past attempt.

- **`toAttemptPayload` is checked by a script, not a test runner.** The project still has no unit-test runner. `toAttemptPayload` (the pure mapper in `app/lib/persistence/payload.ts`) is exercised by `scripts/check-payload.ts`, run with `tsx` (`pnpm dlx tsx scripts/check-payload.ts`). If you change the payload shape, update that script too — it is the only automated check on this mapper.

## Analytics sub-project gotchas

The analytics sub-project has landed: the `/analytics` page (score trend, per-section and
per-skill accuracy, a focus-areas callout, summary stats) reads entirely from the user's
saved attempts.

- **`sat.user_analytics()` is `security invoker` — deliberately unlike the write RPCs.** It is a read-only aggregation, so it runs as the *caller*: RLS on `sat.attempt_responses` (select-only, scoped to `auth.uid()`) confines its results to the signed-in user. No `auth.uid()` filter is *required* for correctness — but the function keeps an explicit `where user_id = auth.uid()` anyway, as a clarity backstop (do not "clean it up"; it documents intent). This is the opposite of the `security definer` write RPCs (`draw_questions`, `save_attempt`), which must bypass RLS to write and therefore set `user_id := auth.uid()` themselves. Keep this distinction: a function that only reads RLS-protected tables should stay `security invoker`; do not make `user_analytics` a definer.
- **Analytics compute helpers are checked by a script, not a test runner.** The pure helpers in `app/lib/analytics/compute.ts` are exercised by `scripts/check-analytics.ts` (`pnpm dlx tsx scripts/check-analytics.ts`). If you change accuracy/sorting/summary logic, update that script too.
- **`ScoreTrend` / `SkillAccuracy` are plain (non-client) components.** They render only SVG/CSS from props — no hooks, no `'use client'`. The `/analytics` page is a server component; keep these dependency-free and server-renderable.

## Admin sub-project gotchas

The admin sub-project has landed: the `/admin` area lets an admin moderate the AI
question pool — browse with section/status filters, inspect a question in full, and
soft-disable (or re-enable) a bad one.

- **`/admin` is gated twice — by the layout AND inside every admin action.** `app/(app)/admin/layout.tsx` calls `requireAdmin()`, so the whole subtree is admin-only. But UI reachability is never the gate: every admin server action (`setQuestionEnabled`) calls `requireAdmin()` again before it writes. `requireAdmin()` returns **404, not 403**, for non-admins (`notFound()`) — the `/admin` area does not advertise its own existence. Keep both checks; do not drop the in-action one on the assumption the layout already gated the page.
- **Admin writes go through the service-role client via a role-gated `'use server'` action.** `sat.questions` is RLS write-locked (select-only policy — see the AI sub-project gotchas). The anon/authenticated role cannot update it, so `setQuestionEnabled` runs `requireAdmin()` and then writes through `createAdminClient()` (service-role, bypasses RLS). The role check is what authorizes the write — the service-role client itself authorizes nothing. Never expose a write path that skips `requireAdmin()`.
- **`sat.questions.enabled` is a soft-disable flag, and `draw_questions` filters it.** Disabling a question never deletes it — it flips `enabled` to `false`, and the `draw_questions` RPC excludes disabled rows, so a disabled question is never served into a test again. Re-enabling flips it back. Do not "clean up" disabled rows by deleting them; the admin pool views (and re-enable) depend on them staying.
- **The `/admin` sub-tree has a hierarchy: Overview at `/admin`, sections under it.** `/admin` itself is the Overview dashboard — it does NOT list questions any more (moved to `/admin/questions`). The sub-nav rendered by the layout (Overview · Question Pool · Users · Open Flags · Settings) is the cross-section navigation; within-section back links are kept (`/admin/users/[id]` → "Back to users", `/admin/questions/[id]` → "Back to the pool"). Don't re-introduce cross-section back links on every page — that pre-dated the nav.
- **Admin reads use a two-layer gate.** `requireAdmin()` in the layout 404s non-admin URLs. The two read RPCs for the Users section (`sat.admin_users_summary`, `sat.admin_user_analytics`) also re-check `sat.profiles.role = 'admin'` inside the function and raise `'not authorized'` otherwise — so even a direct client call by a non-admin gets nothing. New admin read paths should follow this pattern (RPC with internal role check + layout-level `requireAdmin()`), matching the defense-in-depth already used by every admin write path.

## Feedback sub-project gotchas

The feedback sub-project has landed: a user can report a problem with any question
from a test review, and admins triage those reports at `/admin/flags`.

- **`sat.question_flags` has RLS enabled with NO policies.** Like `sat.questions` writes, the table is deliberately policy-less — with RLS on and no policy, the anon/authenticated role can neither read nor write it directly. Users file a flag only through the `sat.submit_flag` security-definer RPC (it bypasses RLS and sets `user_id := auth.uid()` itself). Admins read and resolve flags only through the service-role client (`listFlags` / `countOpenFlags` / `resolveFlag`), always behind `requireAdmin()`. Do not add an RLS policy to "fix" a query — route the access through the RPC or the role-gated service-role path instead.
- **The `FlagQuestion` widget lives inside `ReviewItem`.** It is not wired into the two review pages separately — because `ReviewItem` is the shared per-question review component, `FlagQuestion` automatically appears in *both* the post-test results review and the saved-attempt review (`/dashboard/attempts/[id]`). One placement, two surfaces; do not add a second copy to either page.

## Daily test limit

A per-user daily test-submit cap (UTC calendar day), app-wide, in the single-row
`sat.app_config` table (`daily_attempt_limit`, default 5). Admins edit it at
`/admin/settings` (the `setDailyAttemptLimit` server action, service-role write).

- **Enforced in two places, keep them in sync.** `app/lib/config.ts` (`getAttemptUsage`) feeds the Start screen, which hides the Start button at the limit — `useTestSession.sessionCompletions` is added to the server count so the gate stays accurate across tests taken without a page reload. The `sat.save_attempt` RPC re-checks the limit and raises `daily attempt limit reached` as the airtight backstop. If you change what counts as an "attempt", change both.
- **`sat.app_config` is RLS select-only** (`select` policy + grant for `authenticated`, no write policy) — writes go through the service-role client behind `requireAdmin()`, same pattern as the rest of `/admin`.

## Things that will bite you

- **Answer indices are positional, and choices get shuffled.** In `questions.ts`, `answerIndex` is the index into `choices` *as authored*. `buildTest()` rewrites both arrays in sync — never re-order one without the other.
- **Section keys are `'rw'` and `'math'`** (not `'reading'`, not `'reading-writing'`). Adding a third section requires updating `SECTION_CONFIG`, `SECTION_ORDER`, and confirming `BANK` entries use the new key.
- **Explanations render differently depending on source.** `ReviewItem.tsx` branches on `question.source`: seed explanations (hand-authored, trusted) render via `dangerouslySetInnerHTML`; AI explanations render as React-escaped text. See the AI sub-project gotchas for why — do not collapse these back into a single `dangerouslySetInnerHTML`.
- **Timer auto-advances on zero.** The `useEffect` on `[screen, secIdx]` in `useTestSession.ts` is what restarts the interval, and `handleTimeUp` defers `setSecIdx` via `setTimeout(..., 0)` to avoid setState-mid-render. Don't "simplify" that.
- **Scaled score is a fake.** `scaled = round((400 + pct * 1200) / 10) * 10` — a linear stretch of percent-correct into the 400–1600 range, not a real SAT scale. The README and on-screen note both flag this; don't market it as accurate.
- **`secsPerQ` × question-count = section time.** Adjusting per-question time in `SECTION_CONFIG` silently rescales the whole section timer.
- **`<body>` has `suppressHydrationWarning` set in `app/layout.tsx`** to silence false positives from browser extensions (Grammarly, Dark Reader, password managers) that inject `data-*` attributes into `<body>` after SSR but before React hydrates. The attribute is scoped to `<body>` only — real hydration mismatches anywhere else still surface normally. Do not remove it (you will start seeing the same extension noise) and do not extend it to other elements (real mismatches would hide).

## Adding questions

Append to `BANK` in [app/lib/questions.ts](app/lib/questions.ts). Shape:

```ts
{
  id: 'seed-math-018',  // stable id; `seed-rw-NNN` or `seed-math-NNN`, 1-indexed
  section: 'rw' | 'math',
  skill: 'Linear Equations',
  passage: '…',         // optional, typically rw only
  prompt: '…',
  choices: ['…', '…', '…', '…'],
  answerIndex: 1,       // index into choices, before shuffle (renamed from old `answer`)
  explanation: '…',     // may contain inline HTML (<b>, <i>)
  source: 'seed',
}
```

Quick-mode pulls `shortCount` per section (currently 10). If `BANK` has fewer than `shortCount` in a section, the test silently uses what's there — bump `shortCount` or add questions to keep the experience consistent.
