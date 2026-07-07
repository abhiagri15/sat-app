# Competitive Parity Pack Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the professional-site gaps: official full-test timing + mandatory break, full-test score validity, per-question timing + pacing analytics, math figures, empirical difficulty calibration + admin item stats, answer eliminator, "Explain my mistake."

**Architecture:** One migration (columns + 2 tables + 2 RPCs + two save-RPC revisions); a figure spec/renderer pair; two hook workstreams on `useTestSession` (fidelity/validity, then timing capture — SEQUENTIAL, same file); generation wiring for figures; two UI features; calibration folded into the daily cron.

**Spec (binding, read first):** `docs/superpowers/specs/2026-07-07-competitive-parity-design.md` — sections A–H carry the precision (incl. the spec-review sizing notes: drill hook has NO timers today; figure-through-solver is a multi-method edit; Module-2 failure is currently an unhandled throw; the adaptive chip edit is "remove the in-test conditional block").

**Task order (dependencies):** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Tasks 3 and 4 BOTH rewrite `app/hooks/useTestSession.ts` — never run concurrently. Task 5 and 6 both touch `provider.ts`/`ollama.ts` — sequential. Constants live where the spec says (`TIME_MS_CAP` in the hooks' shared lib or `test.ts`; `FIGURE_SKILLS`/`FIGURE_PROBABILITY` in `generate.ts`; `EXPLAIN_DAILY_CAP` in `app/lib/practice/generation.ts`).

---

## Task 1: Migration `supabase/migrations/20260707040000_sat_parity.sql`

- [ ] Columns: `alter table sat.attempt_responses add column time_ms int, add column figure jsonb;` same two on `sat.practice_responses`; `alter table sat.questions add column figure jsonb, add column difficulty_source text not null default 'model' check (difficulty_source in ('model','empirical'));`
- [ ] Tables (both RLS-on, policy-less, `grant all to service_role` only):
  - `sat.difficulty_calibrations` (id uuid pk default, question_id text not null, old_difficulty text, new_difficulty text, sample_n int, p_value numeric, calibrated_at timestamptz default now()); index (question_id).
  - `sat.coach_explains` (id uuid pk default, user_id uuid not null, question_id text not null, created_at timestamptz default now()); index (user_id, created_at desc).
- [ ] `sat.calibrate_difficulty(p_min_n int default 10) returns int` — security definer, `set search_path to ''`: per spec C (union both response tables for graded counts per question_id, p = correct/total, cuts 0.75/0.40, update differing enabled rows setting difficulty + difficulty_source='empirical', insert audit rows, return relabel count). `grant execute ... to service_role;` ONLY (students must not trigger it).
- [ ] `sat.user_pacing() returns table (skill text, section text, responses bigint, timed bigint, avg_ms numeric)` — security INVOKER, sql, per spec A: union both response tables (join `sat.questions` for section via question_id? NO — both response tables carry `skill`; derive section by joining questions OR carry from `section_key` on attempt_responses / `practice_sessions.section` — implementer picks the simplest correct source and documents it), avg over non-null `time_ms` only, explicit `auth.uid()` backstop. `grant execute ... to authenticated;`
- [ ] Revise `sat.save_attempt`: start from the LATEST definition (base `20260531010000_sat_save_attempt_idempotent.sql`, then apply the `20260531020000` breaks_used delta — read both; the result must contain BOTH prior behaviors). Add: insert `time_ms` (`(r ->> 'timeMs')::int`, null-safe) and `figure` (`r -> 'figure'`, may be null) into attempt_responses. PRESERVE EXACTLY: the attempt_uuid short-circuit BEFORE the daily-limit check, the unique_violation handler, scale_section usage, breaks_used.
- [ ] Revise `sat.save_practice` (base in `20260707000000_sat_practice.sql`): same two column reads added to the responses insert. Preserve idempotency + server-side re-verification untouched.
- [ ] Sanity checklist: no new policies beyond none; 2 `grant all ... service_role`; 2 `grant execute` lines (calibrate→service_role, user_pacing→authenticated); save RPCs contain their full prior bodies (diff mentally against the base files). Commit `feat(db): parity pack — timing/figure columns, calibration, pacing, save RPC revisions`.

**Orchestrator:** apply via MCP; smoke `to_regprocedure` for both new fns; impersonated `save_practice` round-trip with `timeMs` + null figure; `calibrate_difficulty(10)` LIVE run (audit-logged, reversible) and record the relabel count.

## Task 2: Figure schema + renderer + check script

**Files:** Create `app/lib/ai/figure-schema.ts`, `app/components/FigureView.tsx`, `scripts/check-figures.ts`.

- [ ] `figure-schema.ts`: zod discriminated union on `kind` exactly per spec B (table / bar-chart / line-graph / scatterplot / triangle / circle, with the spec's field lists and bounds; all strings `.max(80)`, numbers `.finite()`); export `figureSchema`, `Figure = z.infer`, and `describeFigure(figure: Figure): string` — deterministic plain-text rendering for solver prompts (e.g. table → "Table: <cols>; row 1: ...", scatterplot → "Scatterplot of <yLabel> vs <xLabel> with points (x,y), ...; trend line y = <slope>x + <intercept>").
- [ ] `FigureView.tsx`: plain (no hooks) SVG/HTML renderer per kind, dependency-free (ScoreTrend precedent), `role="img"` + aria-label, axis scaling from data, React-escaped labels, `table` kind renders a real `<table>`. Defensive: `figureSchema.safeParse` at the top — invalid/unknown → render null.
- [ ] `scripts/check-figures.ts` (relative imports, house style): one valid fixture per kind parses; rejections: 6-column table, row-length mismatch, `Infinity` point, 25-point scatterplot; `describeFigure` non-empty + deterministic (call twice, strictEqual) for every kind.
- [ ] Run it + `pnpm type-check`. Commit `feat(figures): figure spec schema + SVG renderer + assertions`.

## Task 3: Full-test fidelity + validity (`useTestSession` workstream 1)

**Files:** Modify `app/lib/questions.ts` (SECTION_CONFIG), `app/lib/test.ts` (if it reads secsPerQ), `app/hooks/useTestSession.ts`, `app/components/TestScreen.tsx`, `app/components/StartScreen.tsx` (error state), `app/components/CalculatorPanel.tsx`; Create `app/components/BreakScreen.tsx`; extend `scripts/check-scoring.ts`.

- [ ] `SECTION_CONFIG`: add `moduleSeconds` (rw 1920, math 2100); make `secsPerQ` a derived value (`moduleSeconds / moduleSize`) — keep the property so all consumers work; full-test module timers init from `moduleSeconds`, short tests from `Math.round(shortCount * secsPerQ)`. Read every `secsPerQ` consumer first (`test.ts`, `useTestSession.ts`) and confirm multiply-only usage.
- [ ] Break: new screen phase `'break'` in `useTestSession` entered after the LAST R&W module submits in a full test (before Math begins): 600-second countdown (own interval, cleaned up), auto-advance at 0, `resumeFromBreak()` for the early button. The section-timer effect's `screen !== 'test'` guard already freezes section clocks. `BreakScreen.tsx`: full-screen card, countdown, "This matches the real SAT's 10-minute break", Resume early button. Wire into `SatPractice`'s phase render.
- [ ] Validity guards per spec G: full-test draw failure in `start()` → NO BANK fallback — set a start-screen error state ("couldn't assemble a full test — retry or take a short test"); Module-1 exact-count check (`drawn[sec].length === moduleSize` for both sections) → same error path; Module-2: wrap `drawModule2` with one automatic retry, second failure → in-test `module2Error` state rendering an overlay with a manual Retry (spec G wording). Short tests keep the BANK fallback unchanged.
- [ ] TestScreen: DELETE the in-test "Adaptive: Harder/Easier" conditional block (the one gated by `!hideModule2Path`) — results/review surfaces untouched.
- [ ] CalculatorPanel: Scientific ⇄ Graphing toggle (swap iframe src `scientific`/`calculator`; small segmented control in the panel header; default scientific).
- [ ] Estimated-score framing (spec G): `ResultsScreen` labels the composite "Estimated score", adds the ± band line ("typically within ±30 per section of a real administration"), and shows `CURVE_VERSION` in the existing curve footnote; same framing on the attempt-review header (`app/(app)/dashboard/attempts/[id]/page.tsx`).
- [ ] `check-scoring.ts`: add asserts `SECTION_CONFIG.rw.moduleSeconds === 1920`, `math.moduleSeconds === 2100`, `Math.abs(secsPerQ*moduleSize - moduleSeconds) < 1` per section.
- [ ] Gates: type-check, lint, run check-scoring + check-payload, build. Commit `feat(test): official module timing, mandatory break, score-validity guards, calculator toggle`.

**Timer-code cautions (CLAUDE.md):** the countdown interval is the sole mutator of `remaining[][]`; `handleTimeUp` defers via setTimeout(0); do not restructure those. The break interval is a SEPARATE interval — never reuse the section one.

## Task 4: Per-question timing capture (`useTestSession` workstream 2 + drill hook)

**Files:** Modify `app/hooks/useTestSession.ts`, `app/hooks/usePracticeSession.ts`, `app/lib/practice/payload.ts`, `app/lib/persistence/payload.ts`, `app/lib/persistence/schema.ts`, `app/lib/practice/schema.ts`; extend `scripts/check-payload.ts` + `scripts/check-practice-payload.ts`.

- [ ] `useTestSession`: `timesMs` accumulator parallel to `responses` (`number[][][]`), ref-based stopwatch: on question display start; stop+accumulate on question switch, module submit, pause, break, and results; capped per spec (`TIME_MS_CAP = 600_000`, exported from `app/lib/test.ts`). Pass into `toAttemptPayload`.
- [ ] `toAttemptPayload(..., timesMs?)`: each response gains `timeMs: number | null` (null when absent/0). `attemptResponseSchema` lists `timeMs: z.number().int().min(0).max(600000).nullable()` (strip-mode!).
- [ ] `usePracticeSession`: fresh stopwatch (start at question display, stop at `check()`, reset on `next()`; cap applies). `DrillResult.timeMs`; `toPracticePayload` maps it; practice schema lists it.
- [ ] Also thread `figure` snapshots NOW (both payload mappers copy `q.figure ?? null` into responses; both schemas list `figure: z.unknown().nullable()` — the RPCs from Task 1 already read it). Question interface gets `figure?: unknown | null` in Task 5 — for this task type it minimally (read Task 5's plan; if landing first, add the optional field to `Question` + `rowToQuestion` passthrough here).
- [ ] Check scripts: fixtures gain timeMs (one null, one set) + figure null; assert both survive zod; assert cap rejection (600001 rejected).
- [ ] Gates: type-check, lint, both payload check scripts, build. Commit `feat(timing): per-question time capture end-to-end + figure snapshot wiring`.

## Task 5: Figure generation + rendering wiring

**Files:** Modify `app/lib/ai/schema.ts` (generatedQuestionSchema), `app/lib/ai/provider.ts` (SolveInput), `app/lib/ai/ollama.ts` (generate + solve + findValidChoices + repairMultiValid prompts), `app/lib/ai/generate.ts` (FIGURE_SKILLS/FIGURE_PROBABILITY + insert), `app/lib/questions.ts` (Question.figure + rowToQuestion), `app/components/QuestionView.tsx`, `app/components/practice/DrillQuestion.tsx`, `app/components/ReviewItem.tsx`, `app/(app)/admin/questions/[id]/page.tsx`.

- [ ] `generatedQuestionSchema`: optional `figure` validated via `figureSchema` (import). `SolveInput` gains optional `figureText?: string`. Every solve/verify/repair prompt builder appends `Figure: ${figureText}` when present (spec: EVERY re-solve path sees it) — grep ollama.ts for all prompt sites first.
- [ ] `generate.ts`: `FIGURE_SKILLS` set + `FIGURE_PROBABILITY = 0.5`; in `generateBatchForSkill`, when section=math ∧ skill ∈ FIGURE_SKILLS ∧ coin, the generation prompt (ollama generateQuestions gains an optional wantFigure flag or figure instructions param — keep the provider signature change minimal and documented) demands a `figure` per the spec shape, with the prompt documenting the exact JSON spec for the 6 kinds and the rule "the prompt text must restate key given values (figure is an aid, not the sole data source)". Candidates with schema-invalid figures are REJECTED (count under rejectedSchema). Insert `figure` when present. Self-verify passes `describeFigure`.
- [ ] `Question.figure?: Figure | null` + `rowToQuestion` passthrough (safe default null).
- [ ] Render: `FigureView` between passage and prompt in `QuestionView`, `DrillQuestion`, `ReviewItem` (snapshot field), admin question detail.
- [ ] Gates: type-check, lint, check-figures, build. Do NOT run live generation. Commit `feat(figures): figure-bearing math generation + rendering across all surfaces`.

## Task 6: Answer eliminator + Explain my mistake

**Files:** Modify `app/components/QuestionView.tsx`, `app/components/practice/DrillQuestion.tsx`, `app/components/ReviewItem.tsx`, `app/lib/ai/provider.ts`, `app/lib/ai/ollama.ts`, `app/lib/practice/generation.ts`; Create `app/lib/ai/explanation-schema.ts`, `app/api/practice/explain/route.ts`, `app/components/ExplainMistake.tsx`.

- [ ] Eliminator per spec D: toolbar "ABC" strike toggle (TestScreen already has a toolbar — place beside calculator/reference; in `DrillQuestion` a small toggle above choices); per-question `Set<number>` local UI state keyed by question id; eliminated → line-through + dimmed + small undo affordance; selecting clears elimination; mcq-only; NOT persisted.
- [ ] `explanation-schema.ts`: `{explanation: string 40–1200, takeaway: string 10–200}`.
- [ ] Provider: required `explainMistake(input): Promise<unknown>` per spec E (input: question fields + choices + correct + the student's chosen/entered); ollama implementation with the data-not-instructions guard and no-letter-references rule.
- [ ] `generation.ts`: `EXPLAIN_DAILY_CAP = 30`; `explainForUser(userId, input)` — count today's `sat.coach_explains` rows for user (service role) → over cap `{status:'capped'}`; else provider → schema (1 retry) → log row → `{status:'ok', explanation, takeaway}` | `{status:'failed'}`.
- [ ] Route `app/api/practice/explain/route.ts` (session-gated pattern from the #14 routes, maxDuration 300): body `{questionId, chosen, entered, snapshot?}`; re-read question by id via user client (RLS select applies); missing/disabled → use `snapshot` fields but mark untrusted in the prompt; 429 on capped, 502 on failed.
- [ ] `ExplainMistake.tsx` ('use client'): button "Explain my mistake" → loading shimmer → inline card (explanation + takeaway, React-escaped) | retry link. Rendered in `DrillQuestion` feedback panel and `ReviewItem` for incorrect responses only.
- [ ] Gates: type-check, lint, build. Commit `feat(coach): answer eliminator + explain-my-mistake`.

## Task 7: Calibration wiring + admin item stats + pacing UI

**Files:** Modify `app/api/admin/generate-questions/route.ts`, `app/lib/admin/queries.ts`, `app/(app)/admin/questions/[id]/page.tsx`, `app/(app)/analytics/page.tsx`, `app/lib/analytics/queries.ts` (or new pacing query), `app/components/practice/DrillSummary.tsx`, `app/(app)/dashboard/attempts/[id]/page.tsx` (+ its row component).

- [ ] Cron route: after generation, `try { calibrated = await ... rpc('calibrate_difficulty', {p_min_n: 10}) via service client } catch { calibrated = -1 }`; add to JSON summary. (Service role has execute; the definer fn runs regardless of RLS.)
- [ ] Admin item stats per spec C: extend the admin question query with response n, p-value, avg time_ms (service-role aggregate over both response tables), flag count, difficulty_source badge; render on the detail page.
- [ ] Pacing: `getPacing()` server query calling `sat.user_pacing()`; `/analytics` Pacing section per spec A (per-section avg vs budget derived from SECTION_CONFIG; 5 slowest skills w/ accuracy; hidden <5 timed samples). Drill summary recap rows + attempt review rows show `Xs` when `time_ms` present.
- [ ] Gates: type-check, lint, build. Commit `feat(analytics): pacing insights, empirical calibration wiring, admin item stats`.

## Task 8: Docs + marketing

- [ ] CLAUDE.md: "Parity sub-project gotchas" — moduleSeconds is authoritative & secsPerQ derived (rewrite the old gotcha); break phase; full-test no-BANK rule; timeMs/figure display-only (never scoring); figure spec safety wall (schema-validated, own renderer, never model markup); calibrate_difficulty service-role-only grant + cron trigger + admin manual-difficulty interplay; coach_explains cap best-effort; new check scripts in Commands (check-figures). Update anything the timing refactor stales.
- [ ] How It Works: adjust the fidelity card ("official 32/35-minute modules, 10-minute break"), figures + pacing mentions, estimated-score FAQ line.
- [ ] Commit `docs: parity pack gotchas + marketing updates`.

## Task 9: Verification (orchestrator-heavy)

- [ ] All gates: type-check, lint, build, ALL check scripts (now 11 with check-figures).
- [ ] Secret scan → the documented 8 files (no new sites; explain route uses generation.ts).
- [ ] Live smokes: save_attempt round-trip with timeMs+figure snapshot (impersonated, verify stored); `user_pacing()` impersonated; one real figure-bearing generation via a smoke run of `generateBatchForSkill` for `Scatterplots & Models` (env-file script, harness precedent) and verify the stored row's figure parses; one real `explainMistake` route-level call is NOT possible without a browser session — instead call the generation-module function directly via the smoke-script pattern; `calibrate_difficulty` already run in Task 1.
- [ ] Estimated-score framing landed (grep ResultsScreen for "Estimated" — it is Task 3's checklist item).
- [ ] Push after green; Vercel deploys.
