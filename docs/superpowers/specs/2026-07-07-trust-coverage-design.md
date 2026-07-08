# Trust & Coverage Pack — Design + Plan

**Date:** 2026-07-07
**Status:** Approved (user directive; GPT-5.5 round-3 triage)
**Sub-project:** #19

## Triage of the external review

Accepted: Playwright E2E (1), planner timezone (2 — a real bug: Vercel
servers run UTC, so "this week" boundaries are wrong for US students),
approved-content gating (3 — in a non-starving form), notes on highlights
(4). Already done: live RPC smokes (5) — all six RPCs were smoke-tested
under impersonation after the migrations; only the explanation cache's
post-cache live round-trip remains (folded into verification). **Deferred
with rationale:** the score-integrity re-architecture (server-held answers
during tests) — it rewrites the test engine (client-side choice shuffling,
client-side Module-2 routing, and instant review all depend on client-held
answer data), the SAVED score is already server-recomputed, and peeking
only inflates a student's own practice estimate. Revisit when scores carry
external stakes; the sketch: server-session test state, `grade_module` RPC
for routing, explanation fetch post-submit.

## A. Review-status gating (content trust without starving assembly)

- **Column:** `sat.questions.review_status text not null default 'active'
  check in ('active','approved','needs_review')`. `enabled=false` remains
  the kill switch (orthogonal).
- **Semantics:** `active` = drawable everywhere (default). `approved` =
  admin-blessed, drawable everywhere, badge in admin. `needs_review` =
  EXCLUDED from scored test draws (short + full), still served by DRILLS —
  drills are low-stakes and generate exactly the response evidence that
  clears or condemns the item.
- **Auto-flagging:** new `sat.flag_needs_review() returns int` — security
  definer, `grant execute to service_role` ONLY. Sets `active →
  needs_review` for enabled questions matching the review-queue criteria
  (open_flags ≥ 2, or n ≥ 10 with p < 0.15 or p > 0.97). NEVER touches
  `approved` (admin judgment outranks the heuristic) and NEVER reverses
  (only an admin clears). Called from `runGeneration()` beside
  `calibrate_difficulty` on every daily tick; count added to
  `GenerationSummary` as `flaggedForReview` (same -1-on-error posture).
- **Draw filter:** `sat.draw_questions` gains `p_strict boolean default
  false` (CREATE OR REPLACE preserves ACLs; new named param is
  deploy-safe — old clients resolve fine). When true, adds `and
  q.review_status <> 'needs_review'` to BOTH the fresh and recycled
  branches. `app/lib/pool.ts`'s `rpcDraw` passes `p_strict: true`
  unconditionally (every pool.ts draw is a scored test). `draw_drill` is
  untouched.
- **Admin:** the `/admin/review` queue rows gain one-click **Approve** and
  **Clear** (→ active) server actions (`requireAdmin()` + service-role
  write, the `setQuestionEnabled` pattern); the question detail page shows
  a `review_status` badge + the same actions; `admin_review_queue` v2
  returns `review_status` so the queue can show it (CREATE OR REPLACE not
  possible — RETURNS TABLE changes → DROP + recreate + RE-GRANT to
  service_role).
- Explicitly NOT the five-state lifecycle: no `generated`/`practice_
  approved` states — at 4,600 items and current review capacity, universal
  human approval would make scored tests impossible; this design hard-gates
  the known-suspect tail instead, which is what actually protects the
  estimated score.

## B. Planner timezone

- **Column:** `sat.study_plans.timezone text` (nullable; IANA name,
  length-checked ≤ 64). `sat.upsert_study_plan` gains `p_timezone text
  default null` (validated: null or plausible IANA shape `^[A-Za-z_]+
  (/[A-Za-z_+-]+)+$|^UTC$`; stored as-is).
- **Capture:** `PlanSetupForm` sends
  `Intl.DateTimeFormat().resolvedOptions().timeZone` with every save.
- **Compute:** new pure `app/lib/planner/timezone.ts`:
  `weekStartInTz(nowIso: string, tz: string | null): string` — the UTC
  instant of the most recent **Monday 00:00 in the given zone** (null/bad
  tz → UTC), implemented with `Intl.DateTimeFormat(..., {timeZone})`
  formatToParts + the standard two-pass offset correction (no new deps;
  DST-safe to the hour). `scripts/check-timezone.ts`: fixtures for UTC,
  America/New_York (incl. a date where UTC's weekday differs from NY's),
  Asia/Kolkata (half-hour offset), garbage tz → UTC fallback, Monday-early
  and Sunday-late boundary cases.
- `getPlannerInputs()` uses `weekStartInTz(now, plan?.timezone ?? null)`
  for `thisWeek` filtering (plan-less users keep UTC — their plan doesn't
  exist yet, so week accuracy is moot).

## C. Notes on highlights (Bluebook parity completion)

- `Interval` gains `note?: string` (≤ 280 chars). Pure-helper updates:
  `mergeIntervals` — when merging, a merged interval keeps the FIRST
  non-empty note (documented; simple + predictable); `setNoteAt(intervals,
  pos, note)`; `segmentText` segments carry `note?`.
- UI: clicking a highlight (highlighter tool ON) now opens a small popover
  anchored to the mark: textarea (280 max), Save / Remove-highlight
  buttons; Escape closes. Noted highlights render with a dotted underline
  + a tiny corner dot; when the highlighter tool is OFF, hovering (or
  tapping) a noted mark shows the note in a `title`-attr tooltip (cheap,
  accessible enough for v1). In-session only, never persisted (unchanged).
- check-highlights: note-preserving merge fixtures + setNoteAt + segment
  note passthrough.

## D. Playwright E2E

- **Stack:** `@playwright/test` (devDependency) + chromium. Config
  `playwright.config.ts`: baseURL `http://localhost:3000`, `webServer`
  spawning `pnpm dev` (reuseExistingServer), workers: 1 (shared account +
  daily limits — serial), retries 0 locally.
- **Auth/test user:** `e2e/global-setup.ts` uses the SERVICE-ROLE key
  (from `.env.local`, never committed) with `auth.admin` to ensure a
  dedicated user `sat-e2e@example.com` (password from `E2E_USER_PASSWORD`
  env or a fixed dev-only default) exists + email-confirmed; signs in once
  via the UI and saves `storageState` to `e2e/.auth/user.json`
  (gitignored).
- **Cleanup:** `e2e/global-teardown.ts` service-role deletes the test
  user's `test_attempts`, `practice_sessions`, `study_plans`,
  `served_questions`, `coach_explains` rows (STRICTLY scoped
  `user_id = <test user id>`) so reruns never hit the daily attempt limit
  and the account stays fresh. Never touches other users' rows or the
  question pool.
- **Specs (v1 flows):**
  1. `short-test.spec.ts` — start a short test; answer 2 (one via
     eliminator interaction), mark one for review; navigator badges;
     Review & submit → Check Your Work (marked/unanswered states) → submit
     both sections → results shows "Estimated score" + save status
     "Saved"; dashboard lists the attempt.
  2. `full-test-fast.spec.ts` — full test WITHOUT waiting on clocks:
     answer a couple in R&W M1 → Review & submit → M2 appears → submit →
     BreakScreen visible → Resume early → Math M1/M2 → results. Asserts
     the adaptive transition and break flow end-to-end.
  3. `crash-recovery.spec.ts` — start a short test, answer one, `page.
     reload()`, assert the "Resume your test?" card, Resume, assert the
     answered state survived; then Discard path on a second run.
  4. `drill.spec.ts` — /practice → open a skill → start drill → answer
     one wrong on purpose is not controllable — instead: answer all 10
     arbitrarily, reach summary, assert save status and (when any recap
     row is incorrect) the miss-reason chips render and a chip click
     persists visually.
  5. `tools.spec.ts` — in a short test on an R&W question: highlighter
     toggle → select text → mark appears → click mark → note popover →
     save note → dotted style; line-reader toggle shows the band; Escape
     dismisses.
  - All specs tolerant of pool variance (no assertions on question text).
- **Scripts:** `package.json`: `"e2e": "playwright test"`,
  `"e2e:headed": "playwright test --headed"`. Docs in CLAUDE.md Commands
  (needs `.env.local` + `pnpm dlx playwright install chromium` once).
  E2E is a LOCAL gate (no CI exists); it is NOT part of the check-script
  battery.

## Security invariants

- `flag_needs_review` service_role-only; the strict filter never widens
  student access; admin actions behind `requireAdmin()` (both layers).
  E2E service-role usage lives ONLY in `e2e/` (node context, gitignored
  auth state, `.env.local` sourced) — the app's 8-file service-role
  invariant is unchanged (the scan covers `app/` only; note it in docs).
- Timezone strings validated at the RPC; used only inside
  `Intl.DateTimeFormat` (throws → UTC fallback in the helper).

## Plan (tasks, strict order)

- **T1** Migration `20260707070000_sat_trust.sql`: review_status column +
  flag_needs_review + draw_questions v3 (p_strict; full prior body
  preserved — read `20260615010000` + confirm no later revision) +
  admin_review_queue v2 (DROP + recreate + re-grant, + review_status col)
  + study_plans.timezone + upsert_study_plan v2 (p_timezone; CREATE OR
  REPLACE fails on new OUT? — it's a new IN param with default: also
  requires DROP? Changing the argument list creates an OVERLOAD, not a
  replacement — DROP the old 3-arg version explicitly and recreate 4-arg +
  re-grant). Commit; orchestrator applies + smokes.
- **T2** Timezone + planner wiring: timezone.ts + check-timezone.ts +
  PlanSetupForm capture + actions/queries updates.
- **T3** Gating wiring: pool.ts p_strict; runGeneration flag call +
  GenerationSummary field; admin Approve/Clear actions + queue/detail
  badges & buttons.
- **T4** Notes on highlights: lib + check updates + popover/tooltip UI.
- **T5** Playwright: deps, config, global setup/teardown, 5 specs,
  scripts, .gitignore entries (`e2e/.auth/`, `test-results/`,
  `playwright-report/`), docs. Then RUN the suite locally and fix what it
  finds (this is the point).
- **T6** Docs (CLAUDE.md gotchas + Commands; How It Works untouched) +
  orchestrator verification: all check scripts (now 16 incl.
  check-timezone), build, live smokes (flag_needs_review dry impact count,
  strict draw excludes a needs_review item, upsert with timezone,
  explanation-cache live round-trip), final review, commit. **NO PUSH.**

## Deferred

Server-held answers during tests (sketch above); five-state lifecycle;
auto-promotion criteria; CI pipeline for E2E; notes export; cross-device
highlight persistence.
