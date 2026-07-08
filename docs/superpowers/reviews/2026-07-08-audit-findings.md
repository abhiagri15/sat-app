# 2026-07-08 Fresh-Eyes Audit — Verified Findings (3 parallel reviewers)

Triggered by GPT-5.5 round-5 (8.8/10). All findings verified with file:line
evidence by read-only audit agents. Status: REPORTED, not yet fixed (except
the E2E locator, fixed same day). This file drives the fix work.

## A. Test-engine bugs (useTestSession.ts) — the serious ones

- **A1 HIGH — Time-up mis-routes Module 2 to 'easier' regardless of performance.**
  The countdown effect (deps `[screen, secIdx, modIdx, paused]`) closes over
  `handleTimeUp` → `submitModule` from module-entry render; `setResponses`
  doesn't refresh it. At zero, the Module-1 routing branch counts `correct`
  from module-entry `responses` (all null) → 0 correct → always `'easier'`
  path → score capped by the easier curve for any student who uses the full
  clock. Final scoring itself is unaffected (computed at render). Fix: call
  through a `handleTimeUpRef` assigned each render (or mirror responses in a
  ref read by submitModule).
- **A2 HIGH — No in-flight guard on the Module-2 draw → double-draw race.**
  `performModule2Draw` / `submitModule` (modIdx still 0 during the awaits) can
  run twice: double-click on "Continue to Module 2" (confirm is dead — A3),
  time-up firing mid-draw (Module-1 interval keeps ticking during the await),
  StrictMode double-invoke in dev (A4). Second `applyModule2Draw` REPLACES
  modules[1] with different questions and re-nulls responses[sec][1] — mid-
  module-2 answers vanish, marks re-point, served_questions double-marked.
  Fix: early-return when `loading` or `modules.length > 1` + in-flight ref in
  performModule2Draw.
- **A3 MEDIUM — Every submit confirm is dead code.** `onClick={onSubmit}`
  passes the MouseEvent as `submitModule`'s `auto` param → truthy → all three
  `if (!auto) window.confirm(...)` guards skipped. Hidden by the interface
  typing `submitModule: () => void`. Fix: wrap callback (`() =>
  onSubmitModule()`). **WARNING: fixing this breaks all four runner E2E specs
  unless `page.on('dialog', d => d.accept())` is added** (Playwright auto-
  dismisses confirms → early return → specs hang).
- **A4 MEDIUM — `setTimeout(() => handleTimeUp(), 0)` lives INSIDE the
  `setRemaining` updater** (impure updater; StrictMode double-invokes it in
  dev → two time-up submits → enables A2). Fix: detect zero outside the
  updater.
- **A5 LOW — `getModule2ThresholdPct` awaited outside performModule2Draw's
  try/catch**: a network-hop failure rejects submitModule unhandled — no
  module2Error overlay, submit silently does nothing. Fix: client-side
  try/catch with DEFAULT_MODULE2_THRESHOLD_PCT fallback.
- **A6 LOW — unanswered counts disagree on cleared SPR entries** (`r === null`
  vs UI's `r.trim() !== ''`); cosmetic once A3 fixed (message never shows
  today).
- A7 INFO — stopwatch accrues alert-dwell + module-2 draw latency to the last
  question (bounded by 600s cap, analytics-only). A8 INFO — crash during
  module-2 draw loses ≤2s of pre-submit state (accepted per spec).

## B. Security / trust

- **B1 — "Cannot fake a 1600" is currently FALSE (self-scoped).**
  `sat.save_attempt` (20260707040000 migration, lines ~273-308) ignores
  client `scaledScore` but feeds `scale_section` the CLIENT-SUPPLIED
  `sectionBreakdown[].correct/total` and stores client `totalCorrect`. SPR
  per-row is_correct IS recomputed but never aggregated back. A crafted
  payload → 1600 in the user's own history/analytics. Low impact (RLS
  self-scoped, no leaderboard) but deviates from the documented invariant.
  Fix: recompute section correct-counts server-side from response rows (join
  sat.questions for mcq answer_index, as the SPR branch already does).
- **B2 MEDIUM — AI cost caps only advance on SUCCESS → failure-loop spend.**
  `/api/practice/lesson`: NO cooldown/cap at all — only gate is the
  skill_lessons existence check; LessonGenerating auto-fires on mount; a
  persistently-failing skill = unbounded Ollama calls from navigation.
  `/api/practice/guidance`: 10-min cooldown only enforced once a row exists.
  `/api/practice/explain`: cap counts coach_explains rows written only on
  success — Retry re-hammers uncharged. Only topup logs unconditionally
  (but AFTER the batch — a killed function never records it → next drill
  refires a full ~21-call batch; write cooldown row BEFORE generating).
  Fix: record attempt timestamps before the Ollama call / failure cooldown;
  give lesson route a real cap.
- **B3 LOW — explain snapshot fallback = semi-arbitrary LLM prompt** under a
  bogus questionId (trusted:false path). Schema-validated + escaped + never
  cached; bounded by cap except for B2's uncharged failures. Fix: require a
  response row for the questionId or drop the fallback.
- Verified clean: service-role confinement (exactly 8 files), PUBLIC_PATHS
  (/how-it-works IS public; CLAUDE.md auth-gotcha list is stale — 5 entries),
  prompt-injection rendering (both dangerouslySetInnerHTML sites seed-gated),
  route validation/IDOR, auth-callback redirect, client bundle env, p_strict
  on all 3 scored draw paths.

## C. Ops / product / commercial

- **C1 HIGH — One live Supabase project for prod+dev+E2E+smokes**, service
  key spans the whole shared PropLedger project (all schemas). E2E saves real
  attempts (bot counts as an "active student" for generator demand; crashed
  run = phantom demand burning Ollama money). Cheapest fix: second free-tier
  Supabase project for dev/E2E (migrations replay), prod key off dev machine.
- **C2 HIGH — Zero observability**: save_failures has no reader (writer only),
  AI failures go to short-lived Vercel logs, cron summary returned to nobody,
  no health/uptime check. Minimal fix: /admin card (save_failures 7d count +
  last-cron status via a sat.generation_runs row) + free UptimeRobot.
- **C3 MED-HIGH — cron can be killed mid-run** (worst-case batch 210-780s vs
  maxDuration 300); calibration + flag_needs_review run AFTER generation so a
  kill silently skips them. Fix: run them BEFORE generation (cheap SQL) +
  persist run summary. Also `chat()` has no AbortController/timeout.
- **C4 MEDIUM — No global AI kill switch / spend visibility** (all caps
  per-user; runaway visible only on Ollama billing page). ~20-line fix:
  `ai_enabled` flag in sat.app_config checked in getProvider(), editable at
  /admin/settings.
- **C5 MEDIUM — Test-runner MCQ choices are div onClick** — no role/tabIndex/
  keyboard; keyboard users cannot answer scored tests (drill's DrillQuestion
  does it right with real buttons — port that). Eliminator ✕ ~24px target.
- **C6 MEDIUM — Passage tools pointer-only**: highlighter needs mouseup+
  getSelection (unreliable on touch), notes are hover-only title attr, line
  reader is pointermove (drag scrolls on touch). iPad = buttons that do
  nothing. Options: selectionchange-based capture + tap-to-show notes, or
  hide tools on `(pointer: coarse)`.
- **C7 MEDIUM — Minors' PII, no privacy/terms/deletion/export**; Vercel Hobby
  prohibits commercial use — outside students require Pro + policy pages +
  delete-account action.
- **C8 MEDIUM — n8n generator difficulty drift degrades adaptive NOW**
  (everything inserts medium; easy/hard cells starve; Module 2 partially
  cosmetic until empirical calibration catches up at n≥10/item). Single best
  fix: make n8n Plan Batches difficulty-aware (generator_state already
  returns per-difficulty cells).
- C9 LOW — E2E account hardcoded default password on prod auth (moot after
  C1). C10 INFO — bus-factor: everything fails silently (n8n death → silent
  recycled repeats; cron death → invisible; Supabase free-tier pause depends
  on sibling-project activity).

## E2E locator (FIXED 2026-07-08)

full-test-fast.spec.ts:41/55 — strict-mode violation: for one effect-flush
after the module-2 draw resolves, the header chip AND the still-open
CheckYourWork subtitle both read "Module 2 of 2" (moduleReview auto-close
effect hasn't flushed). Fixed with `.first()` on both lines; verified passing.
Latent same-pattern risks noted: "Module 1 of" asserts (safe only while
review closed); navigator vs CheckYourWork squares share aria-label format
(never mounted simultaneously today).

## Suggested fix order

1. A1+A2+A3+A4 as one cluster (routing integrity + race; includes E2E dialog
   handling; verify with full e2e run).
2. B2 + C3 + C4 (AI cost hardening: pre-charge caps, cooldown-before-batch,
   calibration-first cron, kill switch).
3. C2 (admin health card + generation_runs) then C1 (second Supabase project).
4. B1 (server-side correct-count recompute — closes the "fake 1600" gap and
   makes the documented invariant true).
5. C5 (keyboard MCQ) then C6 (touch) — fidelity/a11y.
6. C7/C8 when going beyond family use.
