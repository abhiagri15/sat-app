# Gaps Closure Implementation Plan (#17 + #18)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship #17 (highlights + line reader, mid-test crash recovery, explanation cache, admin review queue, contact link) and #18 (miss-reason tagging, study planner).

**Specs (binding — they carry the executor-level precision from a deep code review; read the relevant one IN FULL per task):**
- `docs/superpowers/specs/2026-07-07-fidelity-resilience-design.md` (#17, sections A–E)
- `docs/superpowers/specs/2026-07-07-study-planner-design.md` (#18, sections A–B)

**Standing rules:** repo CLAUDE.md invariants; commit per task with the given message; **NEVER push**. STRICT task order (several tasks touch the same hooks/components).

---

## Task 1 (#17): Migration A + explanation cache

**Files:** Create `supabase/migrations/20260707050000_sat_fidelity.sql`; Modify `app/lib/practice/generation.ts`; Create the `mistakeKey` helper in `app/lib/ai/explanation-schema.ts`; extend a check script.

- [ ] Migration per spec §C+§D: `sat.mistake_explanations` (PK (question_id, chosen_key), RLS select-authenticated, no write policies, grants select→authenticated + all→service_role) + `sat.admin_review_queue(p_limit int default 50)` (security definer; the two-source combination shape from spec §D; `grant execute to service_role` ONLY; house style + comment banner per `20260707040000`).
- [ ] `mistakeKey(responseFormat, chosenText, enteredValue)` pure helper exported from `app/lib/ai/explanation-schema.ts` per spec §C normalization (mcq `mcq:<trim/lower/ws-collapse>`, spr `spr:<parseSpr canonical | trimmed raw>` — import parseSpr).
- [ ] `explainForUser` cache splice per spec §C (outer-scope placement; hit skips cap + returns `cached: true`; miss path unchanged then trusted-only upsert `ignoreDuplicates`).
- [ ] Check fixtures (append to `scripts/check-figures.ts` or a new tiny script — your call, house style): mistakeKey shuffle-invariance, spr "3.5"≡"7/2", cross-question separation is the PK's job (document in fixture comment).
- [ ] Gates: type-check, lint, relevant check scripts. Commit `feat(coach): explanation cache + admin review-queue RPC`. Do NOT apply the migration (orchestrator does).

## Task 2 (#17): Highlights + line reader

**Files:** Create `app/lib/highlights.ts`, `scripts/check-highlights.ts`, `app/components/LineReader.tsx` (if a separate component reads cleaner); Modify `app/components/TestScreen.tsx`, `app/components/QuestionView.tsx`.

- [ ] Pure helpers per spec §A (`mergeIntervals`, `addInterval`, `removeIntervalAt`, `segmentText`) + check script (overlap/adjacency/containment/clamp fixtures).
- [ ] TestScreen: two passage-gated toggles (gate = `question.passage` truthy, NOT section) in the existing tool row; highlight state `Map<questionId, Interval[]>` (eliminator precedent).
- [ ] QuestionView: `ref` on the passage div; new props (highlights, highlighter-on, onAddHighlight, onRemoveHighlightAt, lineReaderOn); selection→offset via text-node walker on mouseup when the tool is on; render passage via `segmentText` → plain + `<mark>` spans (React-escaped, click-to-remove on marks); LineReader overlay per spec (pointer-follow band, dim masks, Escape/toggle off, ArrowUp/Down nudge).
- [ ] Gates: type-check, lint, check-highlights, build. Commit `feat(test): passage highlights + line reader`.

## Task 3 (#17): Mid-test crash recovery

**Files:** Create `app/lib/persistence/inprogress.ts` (snapshot serialize/parse/validate — pure where possible), `scripts/check-recovery.ts`; Modify `app/hooks/useTestSession.ts`, `app/components/StartScreen.tsx`, `app/components/SatPractice.tsx` (only if prop threading requires).

- [ ] Implement EXACTLY spec §B — the snapshot field list (incl. `timesMs` + `marked`; `moduleReview` excluded), pre-advance `secIdx` break semantics, write points + 2s throttle + `visibilitychange`/`pagehide`, try/catch quota safety, 12h freshness, version gate, single-fire restore ref, ref rehydration (`timesMsRef`, `activeQuestionRef=null`), restore-before-resave-effect ordering, `finish()` clear-snapshot-then-write-pending ordering, all clear points.
- [ ] StartScreen: "Resume your test?" card (details per spec) with Resume/Discard.
- [ ] `scripts/check-recovery.ts`: round-trip + version-rejection fixtures over the pure serializer.
- [ ] READ the hook fully first; the countdown/stopwatch/break machinery rules from #15/#16 apply — the ONLY hook changes are snapshot writes at existing state-commit points, the restore path, and the finish-ordering line.
- [ ] Gates: type-check, lint, check-recovery + check-payload, build. Commit `feat(test): mid-test crash recovery via local snapshot`.

## Task 4 (#17): Admin review queue UI + contact link

**Files:** Create `app/(app)/admin/review/page.tsx`; Modify `app/lib/admin/queries.ts`, `app/components/admin/AdminNav.tsx`, `app/(app)/admin/page.tsx`, `app/components/AppHeader.tsx`, `app/how-it-works/_components/MarketingFooter.tsx`.

- [ ] `getReviewQueue()` in admin/queries.ts via service client → `admin_review_queue` RPC; page lists rows (skill, prompt excerpt, n, p, flags, reason chips) linking to `/admin/questions/[id]`; AdminNav tab "Review queue"; Overview count card.
- [ ] Contact link per spec §E: AppHeader plain `mailto:abhishek15@gmail.com` "Contact"; MarketingFooter obfuscated-assembly mailto + "use Report a question for content issues" note.
- [ ] Gates: type-check, lint, build. Commit `feat(admin): needs-review queue + contact links`.

## Task 5 (#18): Migration B + tagging plumbing

**Files:** Create `supabase/migrations/20260707060000_sat_planner.sql`; Modify `app/lib/ai/provider.ts`, `app/lib/ai/ollama.ts`, `app/api/practice/guidance/route.ts`; Create `app/lib/practice/miss-reasons.ts` (the `MISS_REASONS` single-source const: value/label/promptPhrase).

- [ ] Migration per spec: `miss_reason` CHECK columns on both response tables; `sat.tag_miss_reason` (silent no-op semantics, returns boolean); `sat.study_plans` + `sat.upsert_study_plan` (bounds-checked); `sat.miss_reason_mix()` (invoker); **`skill_evidence` DROP + recreate with `miss_reason` + RE-GRANT to authenticated + keep invoker/search_path**; all grants explicit.
- [ ] `MISS_REASONS` const; `GuidanceEvidenceItem.missReason` + route mapping + ollama guidance-prompt line (the 3-place change per spec).
- [ ] Gates: type-check, lint. Commit `feat(db): miss-reason tagging, study plans, evidence v2`. Migration applied by orchestrator.

## Task 6 (#18): Planner compute (pure) + check script

**Files:** Create `app/lib/planner/compute.ts`, `scripts/check-planner.ts`.

- [ ] `PlannerInputs`/`PlanItem`/`OverdueSkill` types + `buildWeekPlan` + `overdueSkills` + `paceSummary` EXACTLY per spec §B rules (slot priority order, done-derivation from this-ISO-week activity passed in as input data, full-SKILLS-taxonomy iteration for never-drilled, reason-aware `why` strings, zero-history seeding). NO I/O in this module; `today` is an input (no `Date.now()` inside compute — testability).
- [ ] Check script fixtures per spec Testing (rich history, zero history, near/far test date, reason-mix `why` variation, overdue cap/sort).
- [ ] Gates: type-check + check-planner. Commit `feat(planner): deterministic week-plan compute`.

## Task 7 (#18): Plan page + integrations

**Files:** Create `app/lib/planner/queries.ts` (assemble `PlannerInputs`: getAnalytics + practice_skill_stats + miss_reason_mix + this-week activity + plan row), `app/lib/planner/actions.ts` ('use server' upsert via RPC), `app/(app)/plan/page.tsx`, plan components as needed; Modify `app/components/AppHeader.tsx` ("Plan" between Practice and Analytics), `app/(app)/practice/page.tsx` ("Do this next" card above focus areas), `app/components/StartScreen.tsx` (one-liner when a plan exists — keep minimal).

- [ ] Per spec §B UI (setup card, pace header, this-week list with done-dimming + hrefs, overdue chips, edit affordance, empty-data state).
- [ ] Gates: type-check, lint, build. Commit `feat(planner): /plan page, setup, and do-this-next integrations`.

## Task 8 (#18): Tagging UI

**Files:** Create `app/components/MissReasonChips.tsx` ('use client': six chips from MISS_REASONS, selected state, calls a 'use server' action wrapping `tag_miss_reason`); Create `app/lib/practice/tag-actions.ts`; Modify `app/components/ReviewItem.tsx` (attempt-review surface — needs the response id + origin props threaded from the attempt page), `app/(app)/dashboard/attempts/[id]/page.tsx`, `app/components/practice/DrillSummary.tsx` + its data flow (fetch practice response ids by session_id after save — an RLS-scoped client query in `app/lib/practice/draw.ts`-style module or via the summary's parent), `app/lib/persistence/queries.ts` (ensure the row id + miss_reason are selected).

- [ ] Per spec §A: chips only on incorrect rows; re-taggable; optimistic UI with server action result reconciliation; drill mapping by `position`.
- [ ] Gates: type-check, lint, build. Commit `feat(coach): miss-reason tagging on reviews and drill recaps`.

## Task 9: Docs + marketing

- [ ] CLAUDE.md: #17 + #18 gotcha sections (snapshot field completeness + break pre-advance secIdx; finish() clear-then-write ordering; cache trusted-only + hit-skips-cap; review queue = computed, not lifecycle; MISS_REASONS 2-place rule incl. SQL CHECK; skill_evidence DROP+re-grant precedent; planner = computed completion, no item storage; contact-link obfuscation rationale). Commands: new check scripts (check-highlights, check-recovery, check-planner).
- [ ] How It Works: one card/FAQ touch for study plan + tools (highlights/line reader) + contact in footer (already Task 4; verify).
- [ ] Commit `docs: gaps-closure gotchas + marketing`.

## Task 10: Verification (orchestrator)

- [ ] Full gates: type-check, lint, build, ALL check scripts (now 14).
- [ ] Secret scan → still the documented 8 files.
- [ ] Apply migrations live + smokes: cache round-trip (explainForUser twice — second returns cached instantly, cap untouched); `admin_review_queue` sane rows; `tag_miss_reason` own-row/wrong-row semantics; `upsert_study_plan` + bounds rejection; `miss_reason_mix` under impersonation; skill_evidence v2 executable by authenticated (the re-grant!).
- [ ] Final quality review agent over the whole diff; fix criticals.
- [ ] Commit any fixes. **DO NOT PUSH.**
