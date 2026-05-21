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
- [app/lib/questions.ts](app/lib/questions.ts) — `BANK` array + `SECTION_CONFIG` + `SECTION_ORDER`. The single source of truth for content and timing.

`buildTest()` in `app/lib/test.ts` is the test-construction pipeline: filters `BANK` by section, shuffles questions, shuffles each question's choices (remapping the stored `answerIndex` to the new position), and slices to `shortCount` for "Quick" or all questions for "Full". A fresh shuffle runs on every "Start a New Test" — there is no persistence (no localStorage, no backend).

Path alias `@/*` → `./*` (repo root) is configured in `tsconfig.json`; cross-directory imports use `@/app/...`, while within a directory relative imports are the convention.

## Auth gotchas

- **The `sat` schema MUST be exposed in Supabase API settings.** The app queries `sat.profiles` via `supabase.schema('sat').from('profiles')` (PostgREST). Supabase only exposes the `public` schema by default. If `sat` is not added to Settings → API → Exposed Schemas, every call to `getOrCreateProfile()` fails — every authenticated page will error. This is a one-time dashboard action on the Property Ledger project (`falgykkspbtrwdcchayi`).

- **`sat.profiles.role` is not user-writable — enforced by a trigger.** The migration uses column-scoped `GRANT`s, but Supabase re-grants table-level `INSERT`/`UPDATE` to `anon`/`authenticated` on tables in exposed schemas (its "grant broad, secure with RLS" model), and RLS only restricts *which rows* a user touches — not *which columns*. So the real guard is the `profiles_protect_role` BEFORE INSERT OR UPDATE trigger (`sat.protect_profile_role()`): for API roles (`anon`/`authenticated`) it forces `role` to `'student'` on insert and silently keeps the existing `role` on update — a user cannot escalate to `admin` via the API. Privileged roles (`postgres`/`service_role`) are unaffected. To promote a user to admin, run a direct `UPDATE` as the `postgres`/service role: `update sat.profiles set role = 'admin' where id = '<user-uuid>';` **If you add another privileged column to `sat.profiles`, extend that trigger.**

- **Profile rows are created by `getOrCreateProfile()`, NOT by a database trigger on `auth.users`.** The Property Ledger Supabase project is shared with the PropLedger app. An `on_auth_user_created` trigger on the shared `auth.users` table would fire for every PropLedger sign-up, creating junk `sat.profiles` rows. Application-code provisioning keeps the SAT app fully confined to the `sat` schema. `getOrCreateProfile()` is called on every authenticated entry point (`AppHeader`, `(app)/page.tsx`, `(app)/dashboard/page.tsx`), so the row is reliably created on first load regardless of sign-up method.

- **Middleware gates everything except `PUBLIC_PATHS`.** The public paths are: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`. Every other route requires a session — `middleware.ts` redirects unauthenticated requests to `/login`. If you add a new public route (e.g. a health-check endpoint), add it to `PUBLIC_PATHS` in `middleware.ts` or it will be gated.

## Things that will bite you

- **Answer indices are positional, and choices get shuffled.** In `questions.ts`, `answerIndex` is the index into `choices` *as authored*. `buildTest()` rewrites both arrays in sync — never re-order one without the other.
- **Section keys are `'rw'` and `'math'`** (not `'reading'`, not `'reading-writing'`). Adding a third section requires updating `SECTION_CONFIG`, `SECTION_ORDER`, and confirming `BANK` entries use the new key.
- **Explanations render as HTML** via `dangerouslySetInnerHTML` in `app/components/ReviewItem.tsx` — existing entries contain `<b>` tags. Treat `explanation` as trusted authored content; do not pipe user input into it.
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
