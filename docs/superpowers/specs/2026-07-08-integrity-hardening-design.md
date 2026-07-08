# Integrity Hardening Pack — Design + Plan

**Date:** 2026-07-08
**Status:** Approved (user "resume" on the recommended plan from the
2026-07-08 audit; see docs/superpowers/reviews/2026-07-08-audit-findings.md
for the evidence behind every item)
**Sub-project:** #20

Scope = audit items A1–A6 (test-engine), B1 (server-recomputed correctness),
B2+C3+C4 (AI cost hardening + kill switch), C2 (observability card), C5
(keyboard MCQ). Explicitly OUT of scope (deferred, documented in the audit
doc): C1 second Supabase project, C6 touch support, C7 privacy/terms, C8
n8n difficulty awareness, B3 explain-snapshot tightening.

---

## T1. Test-engine cluster (A1–A6) — useTestSession.ts + E2E dialog handling

All in `app/hooks/useTestSession.ts` unless noted. These interact; ship as
ONE task verified by the full E2E suite.

- **A1 (routing staleness):** the countdown interval must invoke time-up
  through a ref that is reassigned EVERY render:
  `const handleTimeUpRef = useRef(handleTimeUp); handleTimeUpRef.current = handleTimeUp;`
  and the interval path calls `handleTimeUpRef.current()`. This makes the
  Module-1→2 routing count the LIVE `responses`, not module-entry state.
- **A4 (impure updaters — BOTH timers):** the zero-detection +
  `setTimeout(handleTimeUp)` lives INSIDE the `setRemaining` updater
  (StrictMode double-invokes updaters → double time-up), AND the break
  countdown commits the identical sin: `setTimeout(() => resumeFromBreak(),
  0)` inside the `setBreakRemaining` updater (useTestSession.ts ~315-325).
  `resumeFromBreak` is NOT idempotent — a double-fire runs `setSecIdx(s =>
  s + 1)` twice and skips the entire Math section. Restructure BOTH so the
  updaters are pure: compute the decremented value, detect zero OUTSIDE the
  updater (e.g., track remaining in a ref the interval reads/decrements, or
  fire from the interval callback after setState). Requirements: exactly one
  time-up / one break-resume per zero-crossing in BOTH dev (StrictMode) and
  prod; countdown displays still tick every second; pause/break/review
  guards unchanged.
- **A2 (double-draw race):** two guards. (1) In `submitModule`'s full-test
  `modIdx === 0` branch, early-return when `loading` is true OR
  `test.sections[secIdx].modules.length > 1` (Module 2 already appended).
  (2) An in-flight ref guard that covers the ENTIRE Module-1-submit async
  section — set at entry to the `modIdx === 0` branch (BEFORE the
  `await getModule2ThresholdPct()` hop, which is itself a race window a
  ref inside performModule2Draw alone would miss), cleared in finally.
  The manual `retryModule2` must still work after a FAILED draw (ref
  cleared on failure; `module2ParamsRef` is separate and kept).
- **A3 (dead confirms):** `submitModule(auto = false)` receives the React
  MouseEvent as `auto` because callbacks pass it point-free. Fix BOTH ends:
  wrap every UI callback (`() => submitModule()` at the SatPractice/TestScreen
  wiring and any other point-free pass-through), AND change the signature to
  `submitModule(auto?: boolean)` with an explicit `auto === true` check (so a
  future event-object leak fails safe to "not auto"). Keep the `TestSession`
  interface type honest.
  **E2E consequence (MUST ship in the same commit):** the runner specs
  submit via Check Your Work; once confirms are live, Playwright auto-
  DISMISSES dialogs → early return → specs hang. Register
  `page.on('dialog', (d) => d.accept())` once in the shared `startTest`
  helper in `e2e/support/flows.ts` (covers all four runner specs — verified
  all call startTest; the drill spec has no confirms; the crash-recovery
  Discard path is a plain button, not window.confirm — accepting all
  dialogs breaks nothing). Note: the confirm fires on EVERY non-auto submit
  (only the "N unanswered" sentence is conditional).
- **A5 (unguarded threshold fetch):** wrap the `getModule2ThresholdPct()`
  await in try/catch; on failure use `DEFAULT_MODULE2_THRESHOLD_PCT` and
  proceed. **The constant currently lives UNEXPORTED in server-only
  `app/lib/config.ts` — importing that into the 'use client' hook pulls
  supabase/server transitively (build break; the exact boundary
  config-actions.ts exists to protect).** Move/export it from a client-safe
  module (`app/lib/questions.ts`, alongside SECTION_CONFIG) and have
  config.ts import it from there — one source of truth, client-safe.
- **A6 (unanswered counting):** align `submitModule`'s unanswered counts with
  the navigator/CheckYourWork rule: a response counts as answered when
  `r !== null && (typeof r !== 'string' || r.trim() !== '')`. Extract ONE
  shared predicate (`isAnswered(r)` in `app/lib/test.ts`) and use it at ALL
  SIX sites: the three inline counts in submitModule (~lines 873/894/927),
  `QuestionNavigator.tsx:~48`, `CheckYourWork.tsx:~99`, and the inverse
  "skipped" predicate in `ReviewItem.tsx:~47`.
- **Verification:** full `pnpm e2e` (6/6) + type-check + lint. Manual-logic
  check: no new check script needed (hook logic is E2E-covered), but if
  `isAnswered` lands in test.ts, add 3–4 assertions to an existing check
  script (check-payload.ts is the natural host).

## T2. save_attempt v3 — server-recomputed correctness (B1)

Migration `20260708000000_sat_score_truth.sql`. **Same signature → CREATE OR
REPLACE (body-only change) → ACL preserved; the OVERLOAD RULE does NOT apply.
Do NOT drop the function.** Start from the CURRENT deployed body (the
`20260707040000_sat_parity.sql` revision is the latest — verify no later
revision exists before copying).

- For every response row, recompute `is_correct` server-side:
  - `spr`: keep the existing join/`spr_is_correct` logic (already server-
    computed) — but now AGGREGATE it into the section correct-count.
  - `mcq`: join `sat.questions` by `question_id`; canonical correct TEXT =
    the question's `choices[answer_index]` (mind jsonb 0-based vs SQL 1-based
    indexing — read the actual column types first); the row is correct when
    the SNAPSHOTTED presented `choices[chosen_index]` equals the canonical
    text (trim-compare; the client shuffle permutes order, text is invariant).
    Fallback when the question row is missing/deleted: current behavior
    (client-snapshotted `answer_index = chosen_index`) — a response must
    never fail to save because its question was deleted.
- Aggregate the server-computed per-row correctness into per-section
  `correct` counts (every response row carries `sectionKey` — group by it,
  matching the breakdown entries' `sectionKey`; the current body already
  reads `r ->> 'sectionKey'`). Use those counts for `scale_section`, for the
  STORED `section_breakdown[].correct`, and for `total_correct`. ALSO
  recompute `section_breakdown[].total` and `total_questions` from the
  per-section response-row counts. Client-supplied `correct`/`totalCorrect`
  stay in the wire shape for back-compat but are ignored. Note `v_breakdown`
  is built before the responses insert — run the recompute as a pre-pass/CTE
  over `p_responses`. `sat.questions.choices` is jsonb (0-based `->>` int
  indexing — the text[] 1-based trap does not apply).
- Also write the recomputed `is_correct` to each stored response row (today
  the mcq rows store the client value).
- PRESERVE, byte-for-byte in behavior: the attempt_uuid idempotency
  short-circuit BEFORE the daily-limit check, the unique_violation race
  handler, the daily-limit check, the module2_path validation/raise, timing
  (`time_ms`) and figure snapshot handling, `breaks_used`, `miss_reason`
  untouched.
- **Verification (live):** a lying-client smoke `scripts/smoke-lying-save.ts`
  — sign in as the E2E user (reuse `e2e/support/env.ts` helpers), build a
  payload whose responses are objectively WRONG (mcq chosen text ≠ canonical)
  but whose `sectionBreakdown[].correct` claims all-correct + `totalCorrect`
  maxed + `scaledScore: 1600`; save; read back the attempt: stored
  `total_correct`, per-section `correct`, and `scaled_score` must reflect the
  TRUTH (0 correct). Delete the attempt (service role) after. Also verify a
  legitimate save still round-trips (the E2E short-test spec covers this —
  run it).
- Update the CLAUDE.md "cannot fake a 1600" gotcha HONESTLY: what T2
  delivers is "stored scores/aggregates always agree with the stored
  response rows" — NOT cheat-proofness (an mcq client legitimately knows
  `answer_index` from the draw and can fabricate correct-text response rows;
  `testLength`/`module2Path` stay client-claimed; true cheat-proofness
  requires the deferred server-held-answers architecture). Do not write a
  false invariant.

## T3. AI cost hardening (B2 + C3 + C4)

Migration `20260708010000_sat_ai_guardrails.sql` + TS changes.

- **Tables/columns:**
  - `sat.ai_attempts` (`id uuid pk default gen_random_uuid()`, `kind text
    not null check (kind in ('lesson','guidance'))`, `key text not null`,
    `user_id uuid null`, `attempted_at timestamptz not null default now()`)
    + index `(kind, key, attempted_at desc)`. RLS on, policy-less,
    `grant all ... to service_role` only (the question_flags posture).
  - `sat.generation_runs` (`id uuid pk default gen_random_uuid()`,
    `started_at timestamptz not null default now()`, `completed_at
    timestamptz null`, `summary jsonb null`). Same RLS posture. No pruning
    (one row/day; revisit in a year).
  - `sat.app_config.ai_enabled boolean not null default true`.
- **Charge-BEFORE semantics** in `app/lib/practice/generation.ts`:
  - `ensureBaseLesson`: before calling Ollama, check `ai_attempts` for
    (kind='lesson', key=skill) within `LESSON_RETRY_COOLDOWN_MIN = 10` → if
    found, return the static-fallback path without generating; otherwise
    INSERT the attempt row FIRST, then generate. (Shared per-skill — user_id
    null.) This bounds a failing skill to ~6 Ollama attempts/hour total
    across ALL users instead of unbounded.
  - `regenerateGuidance`: same pattern keyed (kind='guidance', key=skill,
    user_id=user) — closes the "no row yet → no cooldown" first-generation
    hole; keep the existing row-watermark staleness check as-is.
  - `explainForUser`: move the `coach_explains` INSERT to BEFORE the
    generation call (cache-hit path unchanged — still free, still uncapped).
    A failed generation now consumes a cap slot — that is the point.
  - `topupSkill` (or its caller): write the `practice_topups` cooldown row
    BEFORE `generateBatchForSkill`, not after — a killed function must not
    re-arm a fresh ~21-call batch on the next drill save. `inserted` is
    NOT NULL DEFAULT 0: capture the pre-charged row's id and UPDATE
    `inserted` with the real count after the batch (observability only —
    a killed run legitimately leaves 0).
- **Kill switch:** `aiIsEnabled(admin)` helper (reads `app_config.ai_enabled`)
  checked at the TOP of all five expensive entry points: `ensureBaseLesson`,
  `regenerateGuidance`, `topupSkill`, `explainForUser`, and `runGeneration`
  in `app/lib/ai/generate.ts`. Disabled → each returns its existing graceful
  no-op/failure shape (static lesson, `'failed'`, skip). Admin UI: a toggle
  on `/admin/settings` next to the daily-limit control, via a
  `setAiEnabled` server action following the `setDailyAttemptLimit` pattern
  (requireAdmin + service-role write). One config read per generation call
  is acceptable overhead.
- **C3 (cron resilience)** in `runGeneration`, in THIS order: (1) INSERT the
  `generation_runs` started row; (2) run `runCalibration` +
  `runFlagNeedsReview` ONCE (cheap SQL, must not die behind slow Ollama
  batches — remove the three per-return-site calls); (3) THEN the
  `ai_enabled` kill-switch check (so disabling AI never silences the free
  calibration/flagging or the run row); (4) generation; (5) at every return
  path, UPDATE the run row with `completed_at` + summary jsonb. A killed run
  (or the existing generator_state throw path) leaves a started-but-never-
  completed row — exactly the signal T4 surfaces; document that the throw
  path shares it.
- **chat() timeout** in `app/lib/ai/ollama.ts`: AbortController at
  `CHAT_TIMEOUT_MS = 120_000` per call; on abort, throw the normal provider
  error (existing retry/fallback paths handle it). One hung call must not
  eat a whole 300 s function budget.
- **Verification:** type-check/lint/build; live: apply migration, flip
  `ai_enabled` off via SQL, call the lesson route → static fallback + NO
  ai_attempts row for a disabled call... correction: the kill switch check
  precedes the charge — assert no Ollama call AND no attempt row; flip back
  on; run `scripts/smoke-live-rpcs.ts` (should stay 13/13); run the drill
  E2E spec (exercises topup path). Clean any smoke artifacts.

## T4. Admin health card (C2)

- New reads in `app/lib/admin/queries.ts` (ALREADY a service-role module —
  keeps the 8-file invariant; do NOT create a new service-role file):
  `getHealthSummary()` → `{ saveFailures7d: number, lastRun: { startedAt,
  completedAt, accepted, calibrated, flaggedForReview } | null }` from
  `sat.save_failures` (count, `created_at > now()-7d`) + latest
  `sat.generation_runs` row.
- `/admin` Overview: one new card "Health" — save-failure count (red when
  > 0), last generation run time + "did not complete" warning when
  `completed_at` is null on the latest row, accepted/calibrated/flagged
  numbers when present. Follow the existing card markup exactly.
- UptimeRobot (external ping on `/how-it-works` — it's public) is a MANUAL
  step for the user; document in the summary, not in code.
- **Verification:** admin page renders with zero rows (empty-state) and with
  data (after T3's live run row exists).

## T5. Keyboard-accessible MCQ in the test runner (C5)

- `app/components/QuestionView.tsx`: make each choice a real
  `<button type="button">` (semantic, focusable, native Enter/Space) using
  the drill's STRUCTURE — row-DIV containing the choice button (flex-1) and
  a SIBLING eliminator button (never button-inside-button; the current
  markup nests the ✕ inside the clickable row, which would become invalid
  nesting if the row itself turned into a button).
  **KEEP, exactly (the E2E suite anchors on them — the drill pattern has
  NEITHER):** the `LETTERS[i]` letter spans inside each choice (flows.ts
  clicks `span hasText /^A$/`) and the per-letter eliminator aria-labels
  "Eliminate option A" / "Restore option A" (short-test.spec asserts them).
  Preserve: selected styling, strike-through + click-clears-elimination,
  eliminator hit target ≥ 40px, SPR untouched. The passage mouseup handler
  is on the passage div (sibling subtree) — unaffected, but verify.
- Do NOT port the drill's global Enter-advance protocol into the test runner
  (different UX contract; navigation buttons already exist).
- **Verification:** `pnpm e2e` — short-test clicks choices + eliminator and
  must pass unchanged. Add a keyboard assertion to short-test.spec.ts: focus
  a choice via keyboard (Tab) and select with Enter, assert selected state.

## Cross-cutting rules

- One commit per task, message per repo convention; NO push until all five
  land + full verification battery (checks, build, full e2e, live smokes),
  then push per the standing directive.
- Migrations applied live by the orchestrator via Supabase MCP immediately
  after each migration-bearing task, then smoked, BEFORE the next task
  starts.
- After T3 lands, `scripts/smoke-live-rpcs.ts` remains the post-migration
  gate — run it after BOTH migrations.
- CLAUDE.md: update the stale auth-gotcha PUBLIC_PATHS list (it omits
  `/how-it-works` + the cron route), the "cannot fake a 1600" claim (T2),
  and add gotchas for charge-before caps, ai_enabled, the countdown-ref
  pattern (do not reintroduce direct closure calls), and the isAnswered
  single-predicate rule.
- Memory update at the end.
