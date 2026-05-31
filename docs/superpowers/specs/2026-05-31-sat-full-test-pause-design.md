# SAT Full-Test Pause ("Allow breaks") — Design

**Date:** 2026-05-31
**Status:** Pending spec review
**Scope:** A single sub-project. Small, self-contained.

## Problem

The SAT app's full-length adaptive test is timed per module with no way to stop the
clock. Because these are **practice** tests, a student who needs a short break (rest
their eyes, step away) has no option but to let the timer run down or abandon the
attempt. We want a pause capability that lets a student take a genuine break without
losing time — while preserving the strict timed simulation as the default, since
building stamina and pacing is the point of a full-length practice test.

## Goals

1. Let a student pause a full test and resume later **in the same session**, with the
   module timer frozen while paused.
2. Keep the strict timed full test as the **default** experience (opt-in breaks).
3. Make a pause a **real break** — no using paused time to keep working on the current
   question.
4. Record whether an attempt used breaks, so a break-assisted score is
   distinguishable from a strict-timed one.

## Non-Goals (YAGNI)

- **Not** a new scored test type. A break-enabled full test uses the same adaptive
  Module 1 → Module 2 structure, the same `RW_FULL_*` / `MATH_FULL_*` curves, and the
  same `sat.save_attempt`. `breaks_used` is informational and does **not** affect
  scoring.
- **Not** resumable across tab close / reload. Pause is in-session only: the screen
  stays open. Closing the tab still loses the in-progress test, exactly as today. (A
  "resumable tests" feature, if ever wanted, is a separate project requiring full
  in-progress-state serialization.)
- **No** limit on the number or duration of pauses (it's practice).
- **No** pause on Quick (short) tests — they are short by design.

## Key Decisions (resolved during brainstorming)

| Decision | Choice |
|----------|--------|
| Content visibility while paused | **Hidden** behind a full-screen overlay (integrity). |
| How breaks are surfaced | **A toggle on the Full test** ("Allow breaks"), default OFF. Not a separate tile, not a new test type. |
| Track break usage | **Yes** — a `breaks_used` boolean on the attempt, shown as a tag. |
| Cross-close persistence | **In-session only.** |

## Behavior / UX

### Start screen
- The Full test option gains an **"Allow breaks"** checkbox, **default unchecked**.
- The checkbox renders **only when** the selected test length is `full`. Quick tests
  never show it.
- Unchecked Full = today's strict timed simulation, byte-for-byte unchanged.

### During the test (breaks enabled only)
- While a module is active, a **"Pause"** button appears in the test toolbar.
- Clicking **Pause**:
  1. Freezes the module timer (remaining seconds preserved).
  2. Renders a full-screen **PausedOverlay** that covers the entire test surface —
     passage, question, choices, the Math calculator/reference panels, and navigation.
     Its only control is **Resume** (plus a calm "Paused — take your time" message).
  3. Sets `breaksUsed = true` for the attempt (sticky for the rest of the test).
- Clicking **Resume** removes the overlay; the timer continues from the frozen value.
- Pausing is allowed anytime a module is active. Between-module transitions are natural
  stops and need no pause control.

### Results / history
- When `breaksUsed` is true, a small **"taken with breaks"** tag appears on: the results
  screen, the dashboard attempt list row, and the attempt review page.

## Architecture & Components

### `useTestSession` (hook) — state + timer
New state, each scoped to the current test:
- `breaksEnabled: boolean` — **hook-owned state with a `setBreaksEnabled` setter**, exactly
  parallel to the existing `testLength` / `setTestLength` pair. The start-screen toggle
  calls `setBreaksEnabled`. **`start()` keeps its current zero-argument signature** (it
  reads `name` / `testLength` / `breaksEnabled` off hook state) — the existing
  `onStart={s.start}` wiring and `StartScreen`'s zero-arg `onStart()` call are unchanged.
  Inside `start()`, when `testLength === 'short'`, `breaksEnabled` is forced to `false`
  before the test begins, so short tests can never be pausable regardless of toggle state.
- `paused: boolean` — whether the test is currently paused.
- `breaksUsed: boolean` — whether the student paused at least once during this attempt.
  **Sticky invariant:** once `true` it stays `true` for the remainder of the attempt;
  `resume()` does NOT clear it. It is reset to `false` only by `start()` and `newTest()`.

Timer interaction:
- The existing countdown effect (a `setInterval` keyed on `[screen, secIdx, modIdx]`
  that decrements `remaining[secIdx][modIdx]` once per second and auto-submits at zero)
  gains `paused` in its guard and dependency list: **when `paused` is true, the interval
  is not started** (and any running one is cleared). Because `remaining[][]` is mutated
  **only** by that interval, suspending the interval freezes the clock with no separate
  elapsed-time accounting. On resume, the same effect re-creates the interval from the
  preserved `remaining` value. **`paused` must be added to the effect's dependency
  array**, so its existing `return stopTimer` cleanup fires when `paused` flips to `true`
  — therefore `pause()` must NOT call `stopTimer()` itself (redundant); it only flips
  state.

New actions exposed by the hook:
- `pause(): void` — no-op unless `breaksEnabled && screen === 'test' && !paused`. Sets
  `paused = true` and `breaksUsed = true`.
- `resume(): void` — no-op unless `paused`. Sets `paused = false`.

Lifecycle:
- `start()` sets `breaksEnabled` from the toggle (forced `false` for short), and resets
  `paused = false`, `breaksUsed = false`.
- `newTest()` resets `paused = false`, `breaksUsed = false`.
- The auto-submit-on-timeout path cannot fire while paused because the interval that
  triggers it is suspended.

### `StartScreen` (component)
- Renders the "Allow breaks" checkbox when `testLength === 'full'`, wired to a new
  `breaksEnabled` / `setBreaksEnabled` prop pair (parallel to `testLength`).

### `TestScreen` (component)
- Renders a **Pause** button in the toolbar only when `breaksEnabled` is true.
- Renders `<PausedOverlay onResume={resume} />` when `paused` is true.

### `PausedOverlay` (new component)
- `'use client'`, props: `{ onResume: () => void }`.
- Full-screen fixed overlay (high z-index) that visually covers the entire test surface.
- Single primary action: **Resume**. Optional neutral copy ("Paused — take your time.").
- No timer, no question content, no calculator. What it does: blocks all test content
  and offers Resume. Depends only on its `onResume` prop.

### `SatPractice` (component)
- Threads the new hook fields/props to `StartScreen` (toggle) and `TestScreen`
  (pause button + overlay), following the existing prop-passing pattern.

### Persistence path (data)
- **Migration** (`20260531020000_sat_attempt_breaks_used.sql`, timestamped to sort after
  `20260531010000`): `alter table sat.test_attempts add column if not exists breaks_used
  boolean not null default false;` **plus** a recreation of `sat.save_attempt` (see below).
- **`AttemptPayload`** ([app/lib/persistence/payload.ts](Personal/satpracticereact/sat-app/app/lib/persistence/payload.ts))
  gains a **required** `breaksUsed: boolean` field.
- **`toAttemptPayload`** gains a **required 5th positional parameter** `breaksUsed: boolean`
  (signature becomes `(test, responses, results, testLength, breaksUsed)`); it copies that
  value onto the payload. The hook is the sole caller and passes its `breaksUsed` state.
  No short-test special-casing is needed at this call site: `breaksUsed` can only become
  `true` via `pause()`, which is gated on `breaksEnabled`, which `start()` forces to
  `false` for short tests — so short tests already always yield `false`. Do **not** add a
  redundant second guard.
- **zod schema** ([app/lib/persistence/schema.ts](Personal/satpracticereact/sat-app/app/lib/persistence/schema.ts)):
  add `breaksUsed: z.boolean().optional()` at the **wire-validation** layer (lenient for
  backward compatibility of the wire shape — an older client omitting it must still
  validate), mirroring the existing `.optional()` precedent for `moduleIndex` /
  `module2Path`. Note the asymmetry is intentional: the in-memory `AttemptPayload` type
  is strict (the hook always supplies the field), while the wire schema is lenient.
- **`saveAttempt`** ([app/lib/persistence/actions.ts](Personal/satpracticereact/sat-app/app/lib/persistence/actions.ts)):
  include `breaksUsed: p.breaksUsed ?? false` in the `p_attempt` jsonb sent to the RPC.
- **`sat.save_attempt`** (recreated in the migration): write
  `coalesce((p_attempt ->> 'breaksUsed')::boolean, false)` into `test_attempts.breaks_used`
  as one extra column in the existing attempt `INSERT`. **Preserve verbatim** the
  idempotency short-circuit ordering and the `unique_violation` handler from migration
  `20260531010000`, and all current scoring/insert logic — this change only adds one
  column to the `INSERT` column list + values.
- **Read path:** `listAttempts()` and `getAttempt(id)` in
  [app/lib/persistence/queries.ts](Personal/satpracticereact/sat-app/app/lib/persistence/queries.ts)
  add `breaks_used` to their `select` and to the returned row type, so the field reaches:
  (1) the dashboard list rows, (2) the attempt-detail review page. For the **results
  screen**, `breaksUsed` is threaded into `ResultsScreen`'s props directly from the hook
  via `SatPractice` (it is not part of the `Results` object — add an explicit
  `breaksUsed: boolean` prop, parallel to how `saveStatus` is passed).

## Data Flow

```
StartScreen toggle ─▶ useTestSession.breaksEnabled
                         │
              start()    ▼
        (full only) breaksEnabled=true, paused=false, breaksUsed=false
                         │
   Pause click ─▶ pause(): paused=true, breaksUsed=true ─▶ timer interval suspended
                         │                                   PausedOverlay covers screen
   Resume click ─▶ resume(): paused=false ─▶ timer interval resumes from remaining[][]
                         │
   submit/finish ─▶ toAttemptPayload(..., breaksUsed) ─▶ saveAttempt(p_attempt.breaksUsed)
                         │
              sat.save_attempt ─▶ test_attempts.breaks_used
                         │
        dashboard / review read breaks_used ─▶ "taken with breaks" tag
```

## Error Handling & Edge Cases

- **Integrity:** hidden content during pause guarantees no free working time.
- **Timeout while paused:** impossible — the auto-submit interval is suspended.
- **Breaks disabled / short tests:** none of the pause surface renders; the strict
  full-test and short-test flows are unchanged.
- **Double pause / resume races:** `pause()`/`resume()` are guarded no-ops outside their
  valid state, so repeated clicks are safe.
- **Backward-compatible save:** a missing `breaksUsed` in the wire payload defaults to
  `false` at both the zod and SQL layers; existing rows keep `false` via the column
  default.
- **Tab close while paused:** in-progress test is lost (unchanged from today; documented
  limitation).

## Testing

- **`scripts/check-payload.ts`** (the project has no unit-test runner): extend to assert
  `breaksUsed` flows through `toAttemptPayload` — `false` when the 5th arg is `false` and
  `true` when it is `true` (the param is required, so there is no implicit default), and
  that the existing short-test call yields `false`.
- **Manual verification:** with breaks enabled, start a full test → Pause mid-module →
  confirm the clock is frozen and all content is hidden → Resume → confirm the clock
  continues from where it stopped → submit → confirm the saved attempt has
  `breaks_used = true` and the "taken with breaks" tag shows on results, dashboard, and
  review. Repeat with breaks OFF to confirm no pause UI and `breaks_used = false`.
- The timer-freeze logic lives in the hook and is not unit-scriptable without a runner;
  it is covered by the manual check, consistent with how the existing timer is verified.

## Files Touched (summary)

- `supabase/migrations/20260531020000_sat_attempt_breaks_used.sql` (new) — `breaks_used`
  column + `save_attempt` recreation preserving the idempotency short-circuit + handler.
- `app/hooks/useTestSession.ts` — `breaksEnabled`/`setBreaksEnabled`/`paused`/`breaksUsed`
  state, `paused` in the timer guard + deps, `pause`/`resume`, lifecycle resets, the
  `toAttemptPayload` 5th-arg call.
- `app/components/StartScreen.tsx` — the "Allow breaks" toggle (rendered only when
  `testLength === 'full'`), new `breaksEnabled`/`setBreaksEnabled` props.
- `app/components/TestScreen.tsx` — Pause button (only when `breaksEnabled`) + `PausedOverlay` mount.
- `app/components/PausedOverlay.tsx` (new) — full-screen overlay, single `onResume` prop.
- `app/components/SatPractice.tsx` — thread `breaksEnabled`/`setBreaksEnabled` to
  `StartScreen`, `breaksEnabled`/`paused`/`pause`/`resume` to `TestScreen`, `breaksUsed`
  to `ResultsScreen`.
- `app/components/ResultsScreen.tsx` — new `breaksUsed` prop + "taken with breaks" tag.
- `app/lib/persistence/payload.ts` (`breaksUsed` field + 5th param), `schema.ts`
  (`breaksUsed: z.boolean().optional()`), `actions.ts` (`p_attempt.breaksUsed`).
- `app/lib/persistence/queries.ts` — `listAttempts()` / `getAttempt()` select + return
  `breaks_used`; the dashboard list row component and attempt-detail review render the tag.
- `scripts/check-payload.ts` — assert `breaksUsed` passes through (`true` when the 5th arg
  is `true`, `false` when `false`).
- `CLAUDE.md` — a short gotcha documenting the pause/timer-freeze mechanic and that
  `breaks_used` is **informational only** — it must never be read by `sat.scale_section`
  or any scoring path (consistent with the "scaled_score is server-trusted" discipline).
