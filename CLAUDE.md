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

There are no tests in this project.

## Architecture

Next.js 15 **App Router**, TypeScript, React 19. The app is decomposed into focused modules.

- [app/(app)/page.tsx](app/(app)/page.tsx) — server entry (authenticated), reads the profile, renders `<SatPractice studentName={...} />`.
- [app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx) — dashboard; shows signed-in user and a test-history placeholder.
- [app/(auth)/login/page.tsx](app/(auth)/login/page.tsx) — email/password sign-in + Google OAuth button.
- [app/(auth)/register/page.tsx](app/(auth)/register/page.tsx) — account creation.
- [app/(auth)/forgot-password/page.tsx](app/(auth)/forgot-password/page.tsx) — password-reset request.
- [app/(auth)/reset-password/page.tsx](app/(auth)/reset-password/page.tsx) — new-password form.
- [app/auth/callback/route.ts](app/auth/callback/route.ts) — exchanges the OAuth/email-link `code` for a session; redirects into the app.
- [middleware.ts](middleware.ts) — refreshes the Supabase session cookie every request; redirects unauthenticated traffic to `/login`. Public paths: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`.
- [app/components/AppHeader.tsx](app/components/AppHeader.tsx) — server component; shows title, `/dashboard` link, user display name, and a Sign out button.
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
- [app/lib/ai/generate.ts](app/lib/ai/generate.ts) — `runGeneration()`: checks pool depth per `(section, skill)`, picks the most-depleted skills (at most 2/run, 3 questions/skill), runs the quality gate (zod → self-verify → dedup), and inserts survivors via the service-role client.
- [app/api/admin/generate-questions/route.ts](app/api/admin/generate-questions/route.ts) — `GET` handler; secret-gated by `CRON_SECRET`; calls `runGeneration()` and returns a JSON summary. In `middleware.ts` `PUBLIC_PATHS` (not session-gated) but requires the bearer secret.
- [scripts/seed-questions.ts](scripts/seed-questions.ts) — one-time seed script: upserts `BANK` into `sat.questions` (`source='seed'`) via the service-role client. Run with `pnpm dlx tsx --env-file=.env.local scripts/seed-questions.ts`.
- [vercel.json](vercel.json) — Vercel Cron: `0 */6 * * *` → `/api/admin/generate-questions`.

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

## Things that will bite you

- **Answer indices are positional, and choices get shuffled.** In `questions.ts`, `answerIndex` is the index into `choices` *as authored*. `buildTest()` rewrites both arrays in sync — never re-order one without the other.
- **Section keys are `'rw'` and `'math'`** (not `'reading'`, not `'reading-writing'`). Adding a third section requires updating `SECTION_CONFIG`, `SECTION_ORDER`, and confirming `BANK` entries use the new key.
- **Explanations render differently depending on source.** `ReviewItem.tsx` branches on `question.source`: seed explanations (hand-authored, trusted) render via `dangerouslySetInnerHTML`; AI explanations render as React-escaped text. See the AI sub-project gotchas for why — do not collapse these back into a single `dangerouslySetInnerHTML`.
- **Timer auto-advances on zero.** The `useEffect` on `[screen, secIdx]` in `useTestSession.ts` is what restarts the interval, and `handleTimeUp` defers `setSecIdx` via `setTimeout(..., 0)` to avoid setState-mid-render. Don't "simplify" that.
- **Scaled score is a fake.** `scaled = round((400 + pct * 1200) / 10) * 10` — a linear stretch of percent-correct into the 400–1600 range, not a real SAT scale. The README and on-screen note both flag this; don't market it as accurate.
- **`secsPerQ` × question-count = section time.** Adjusting per-question time in `SECTION_CONFIG` silently rescales the whole section timer.

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
