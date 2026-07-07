# Mark for Review + Check Your Work — Design

**Date:** 2026-07-07
**Status:** Approved (user-requested; originated from a real student)
**Sub-project:** #16 — Mark for Review

## Problem

Bluebook lets a student bookmark ("Mark for Review") any question during a
module and shows a "Check Your Work" page — every question's
answered/unanswered/marked status, click-to-jump — before the module is
submitted, with the clock still running. The app has neither, so students
can't practice triage (answer what you know, mark the rest, return with the
remaining time), and the module-submit flow is a single irreversible button.
A real student asked for exactly this.

## Design

### State (all in `useTestSession`, UI-only, never persisted)

- `marked: Set<string>` keyed `"${secIdx}-${modIdx}-${qIdx}"`; `toggleMarked()`
  toggles the current question; cleared in `start()` / `newTest()`. Marks are
  module-scoped by keying (a module's review only ever reads its own keys;
  nothing carries across modules or sections — Bluebook behavior).
- `moduleReview: boolean` + `openModuleReview()` + `closeModuleReview(qi?)`
  (optional jump target — sets `qIdx` and returns to the question view).
- `screen` stays `'test'` throughout — the section countdown keeps running
  during review (authentic; zero timer changes). Time-up auto-submit is
  UNCHANGED and bypasses review. `submitModule()` itself is untouched — the
  review page is the only UI path that calls it; all downstream flow
  (Module-2 routing/draw, break phase, results) is untouched.

### UI

- **Mark toggle** in the `TestScreen` question header row: a bookmark icon +
  "Mark for Review" label, toggled state visually distinct (filled amber
  bookmark). Terminology note: ALWAYS "Mark for Review" — never "flag" — the
  app already uses flag = report-a-bad-question (`FlagQuestion`), and the two
  must not blur.
- **QuestionNavigator**: marked questions get a small bookmark corner badge
  on their number square (answered/current styling unchanged); the submit
  button becomes "Review & submit" and calls `openModuleReview()` instead of
  submitting directly.
- **QuestionView Next on the last question** also opens the review page
  (Bluebook behavior) instead of being inert.
- **New `CheckYourWork` component** (rendered by `TestScreen` in place of the
  question + navigator when `moduleReview`; TopBar/timer stays visible):
  heading "Check your work", module/section label, a legend
  (answered / unanswered / marked for review), a grid of question squares —
  answered = filled, unanswered = hollow, marked = bookmark badge, click =
  jump back to that question — a secondary "Back to question" button, and
  the primary submit button carrying the existing FSM label ("Continue to
  Module 2" / "Submit section" / "Submit test") that calls `submitModule()`.
- Pause overlay and break behavior interact with nothing here (review is
  just another in-test render; pausing while reviewing is fine).
- SPR questions markable like mcq. Drills: NOT included (instant feedback
  makes marking meaningless there).

## Explicitly deferred

- Persisting marks to `attempt_responses` (future analytics: "marked → 
  changed answer → outcome" is coach/miss-reason (#17?) evidence). No DB
  work in v1.
- Marks surfacing in results/review pages.

## Testing

Pure-logic surface is tiny (a Set toggle); no new check script. Gates:
type-check, lint, build. Manual smoke: mark → navigate → review → jump back →
submit; time-up mid-review auto-submits; short and full tests; Module-2 and
break flows unchanged.
