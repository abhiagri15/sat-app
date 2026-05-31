# SAT Full-Test Pause ("Allow breaks") Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student opt into pausing a full-length SAT practice test (timer frozen, content hidden during the break), and record whether breaks were used — without changing scoring or the default strict timed simulation.

**Architecture:** A per-session `breaksEnabled` flag (start-screen toggle, default OFF) gates a Pause button on the test screen. Pausing freezes the existing module-timer interval (the sole mutator of `remaining[][]`) and renders a full-screen overlay; resuming restarts the same interval from the preserved value. A `breaks_used` boolean threads through the existing save payload → `sat.save_attempt` → `test_attempts`, surfaced as an informational tag. No new scored test type; in-session only.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (Postgres `sat` schema, security-definer RPCs), Tailwind. No unit-test runner — pure logic is verified by `scripts/check-*.ts` (run with `pnpm dlx tsx`), the rest by `pnpm type-check`, `pnpm build`, and manual checks.

**Spec:** `docs/superpowers/specs/2026-05-31-sat-full-test-pause-design.md`

**Conventions to respect:**
- `sat.test_attempts` is RLS select-only; the only writer is the `sat.save_attempt` security-definer RPC. Do not add a write policy.
- `RW_FULL_*` / `MATH_FULL_*` curves and `sat.scale_section` are unchanged — `breaks_used` MUST NOT be read by any scoring path.
- The `save_attempt` idempotency short-circuit (before the daily-limit check) and the `unique_violation` handler from migration `20260531010000` must be preserved verbatim.
- Commit after each task. Sub-projects land directly on `main` (no feature branch), then push (auto-deploys to Vercel).

---

## Chunk 1: Data layer + session hook

### Task 1: Migration — `breaks_used` column + `save_attempt` recreation

**Files:**
- Create: `supabase/migrations/20260531020000_sat_attempt_breaks_used.sql`

This recreates `sat.save_attempt` from `20260531010000` verbatim, adding exactly: (a) the `breaks_used` column, (b) `v_breaks_used` read from the payload, (c) the column in the `INSERT`. The idempotency short-circuit and `unique_violation` handler are unchanged.

- [ ] **Step 1: Write the migration file**

```sql
-- 20260531020000_sat_attempt_breaks_used.sql
-- Full-test pause ("Allow breaks"): record whether an attempt used breaks.
-- Informational only — NEVER read by sat.scale_section or any scoring path.
-- Recreated from 20260531010000 with one extra column write; the idempotency
-- short-circuit and unique_violation handler are preserved verbatim.

alter table sat.test_attempts
  add column if not exists breaks_used boolean not null default false;

create or replace function sat.save_attempt(p_attempt jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
  v_existing uuid;
  v_attempt_uuid uuid;
  v_breaks_used boolean;
  v_today_count int;
  v_daily_limit int;
  v_test_length text;
  v_breakdown    jsonb;
  v_scaled_score int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
  end if;

  v_attempt_uuid := nullif(p_attempt ->> 'attemptUuid', '')::uuid;
  if v_attempt_uuid is not null then
    select id into v_existing
    from sat.test_attempts
    where user_id = v_user and attempt_uuid = v_attempt_uuid;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select daily_attempt_limit into v_daily_limit from sat.app_config limit 1;
  if v_daily_limit is null then v_daily_limit := 5; end if;
  select count(*) into v_today_count
  from sat.test_attempts
  where user_id = v_user
    and created_at >= date_trunc('day', now() at time zone 'UTC');
  if v_today_count >= v_daily_limit then
    raise exception 'daily attempt limit reached';
  end if;

  v_test_length := p_attempt ->> 'testLength';
  v_breaks_used := coalesce((p_attempt ->> 'breaksUsed')::boolean, false);

  v_breakdown := (
    select jsonb_agg(
      jsonb_build_object(
        'name',         e ->> 'name',
        'sectionKey',   e ->> 'sectionKey',
        'correct',      (e ->> 'correct')::int,
        'total',        (e ->> 'total')::int,
        'module2Path',  e ->> 'module2Path',
        'scaled',       sat.scale_section(
                          e ->> 'sectionKey',
                          (e ->> 'correct')::int,
                          (e ->> 'total')::int,
                          v_test_length,
                          e ->> 'module2Path'
                        )
      )
      order by ord
    )
    from jsonb_array_elements(p_attempt -> 'sectionBreakdown')
      with ordinality as t(e, ord)
  );

  v_scaled_score := (
    select coalesce(sum((e ->> 'scaled')::int), 0)
    from jsonb_array_elements(v_breakdown) e
  );

  insert into sat.test_attempts (
    user_id, student_name, test_length,
    total_correct, total_questions, scaled_score, section_breakdown,
    attempt_uuid, breaks_used
  ) values (
    v_user,
    p_attempt ->> 'studentName',
    v_test_length,
    (p_attempt ->> 'totalCorrect')::int,
    (p_attempt ->> 'totalQuestions')::int,
    v_scaled_score,
    v_breakdown,
    v_attempt_uuid,
    v_breaks_used
  )
  returning id into v_id;

  insert into sat.attempt_responses (
    attempt_id, user_id, section_key, section_name, position,
    question_id, skill, source, passage, prompt, choices,
    answer_index, explanation, chosen_index, is_correct,
    response_format, entered_value, correct_answer, answer_tolerance,
    module_index
  )
  select
    v_id, v_user,
    r ->> 'sectionKey',
    r ->> 'sectionName',
    (r ->> 'position')::int,
    r ->> 'questionId',
    r ->> 'skill',
    r ->> 'source',
    r ->> 'passage',
    r ->> 'prompt',
    r -> 'choices',
    (r ->> 'answerIndex')::int,
    r ->> 'explanation',
    nullif(r ->> 'chosenIndex', '')::int,
    case
      when coalesce(r ->> 'responseFormat', 'mcq') = 'spr' then
        sat.spr_is_correct(r ->> 'enteredValue', q.correct_answer, q.answer_tolerance)
      else
        (r ->> 'isCorrect')::boolean
    end,
    coalesce(r ->> 'responseFormat', 'mcq'),
    r ->> 'enteredValue',
    q.correct_answer,
    q.answer_tolerance,
    nullif(r ->> 'moduleIndex', '')::int
  from jsonb_array_elements(p_responses) as r
  left join sat.questions q on q.id = r ->> 'questionId';

  return v_id;

exception
  when unique_violation then
    if v_attempt_uuid is null then
      raise;
    end if;
    select id into v_existing
    from sat.test_attempts
    where user_id = v_user and attempt_uuid = v_attempt_uuid;
    if v_existing is null then
      raise;
    end if;
    return v_existing;
end;
$$;

grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;
```

- [ ] **Step 2: Apply the migration to the live DB**

Apply via the Supabase MCP `apply_migration` (name `sat_attempt_breaks_used`) — this project's DB is managed through MCP, and the instrumentation/feature is inert until the column exists. (If MCP is unavailable, run the file through the project's normal migration path.)

- [ ] **Step 3: Verify structurally** (read-only; do NOT insert test rows into `test_attempts`)

Run via MCP `execute_sql`:
```sql
select
  (select count(*) from information_schema.columns
     where table_schema='sat' and table_name='test_attempts' and column_name='breaks_used') as has_column,
  (select pg_get_functiondef('sat.save_attempt(jsonb,jsonb)'::regprocedure) like '%breaks_used%') as fn_writes_column,
  (select pg_get_functiondef('sat.save_attempt(jsonb,jsonb)'::regprocedure) like '%unique_violation%') as handler_preserved;
```
Expected: `has_column=1`, `fn_writes_column=true`, `handler_preserved=true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260531020000_sat_attempt_breaks_used.sql
git commit -m "feat(db): add test_attempts.breaks_used; save_attempt writes it"
```

---

### Task 2: Payload mapper — `breaksUsed` 5th parameter (TDD)

**Files:**
- Modify: `app/lib/persistence/payload.ts` (interface `AttemptPayload`, function `toAttemptPayload`)
- Test: `scripts/check-payload.ts`

- [ ] **Step 1: Extend the check script with the failing assertions**

In `scripts/check-payload.ts`, the existing call is `toAttemptPayload(test, responses, results, 'short')`. Change it to pass `false` and add a second mapping with `true`. Add after the existing payload is built (around line 31):

```ts
// breaksUsed flows through (5th arg, required — no implicit default).
const payloadNoBreaks = toAttemptPayload(test, responses, results, 'short', false);
assert(payloadNoBreaks.breaksUsed === false, 'breaksUsed false when 5th arg is false');
const payloadWithBreaks = toAttemptPayload(test, responses, results, 'short', true);
assert(payloadWithBreaks.breaksUsed === true, 'breaksUsed true when 5th arg is true');
```
Also update the original line 31 call to `toAttemptPayload(test, responses, results, 'short', false)` so the existing assertions still compile.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm dlx tsx scripts/check-payload.ts`
Expected: FAIL (TypeScript/tsx error — `toAttemptPayload` expects 4 args, or `breaksUsed` missing on the payload type).

- [ ] **Step 3: Implement — add the field and param**

In `app/lib/persistence/payload.ts`, add to the `AttemptPayload` interface (after `scaledScore: number;`):
```ts
  breaksUsed: boolean;   // informational — did the student pause during this attempt?
```
Change the `toAttemptPayload` signature:
```ts
export function toAttemptPayload(
  test: Test,
  responses: ResponseValue[][][],
  results: Results,
  testLength: TestLength,
  breaksUsed: boolean,
): AttemptPayload {
```
And add `breaksUsed,` to the returned object (next to `scaledScore: results.scaled,`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm dlx tsx scripts/check-payload.ts`
Expected: `ALL CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add app/lib/persistence/payload.ts scripts/check-payload.ts
git commit -m "feat(persistence): thread breaksUsed through toAttemptPayload"
```

---

### Task 3: zod schema + `saveAttempt` action — send `breaksUsed` to the RPC

**Files:**
- Modify: `app/lib/persistence/schema.ts`
- Modify: `app/lib/persistence/actions.ts`

- [ ] **Step 1: Add the wire field to the zod schema (lenient)**

In `app/lib/persistence/schema.ts`, inside `attemptPayloadSchema` object (next to `scaledScore`), add:
```ts
  breaksUsed: z.boolean().optional(),   // wire-lenient for backward compat; in-memory type is strict
```

- [ ] **Step 2: Include it in the RPC payload**

In `app/lib/persistence/actions.ts`, in the `p_attempt` object passed to `.rpc('save_attempt', ...)`, add after `sectionBreakdown: p.sectionBreakdown,`:
```ts
      breaksUsed: p.breaksUsed ?? false,
```

- [ ] **Step 3: Verify type-check passes**

Run: `pnpm type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/persistence/schema.ts app/lib/persistence/actions.ts
git commit -m "feat(persistence): send breaksUsed in save_attempt payload"
```

---

### Task 4: `useTestSession` — state, timer freeze, pause/resume, lifecycle

**Files:**
- Modify: `app/hooks/useTestSession.ts`

Current timer effect (≈ lines 95-113) decrements `remaining[secIdx][modIdx]` on `[screen, secIdx, modIdx]`; `return stopTimer` is its cleanup. `start()` is zero-arg. The save effect calls `toAttemptPayload(test, responses, results, testLength)`.

- [ ] **Step 1: Add state to the `TestSession` interface**

In the interface, after `testLength` / `setTestLength`, add:
```ts
  breaksEnabled: boolean;
  setBreaksEnabled: (b: boolean) => void;
  paused: boolean;
  pause: () => void;
  resume: () => void;
  breaksUsed: boolean;
```

- [ ] **Step 2: Add the state declarations**

Near the other `useState` calls:
```ts
  const [breaksEnabled, setBreaksEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [breaksUsed, setBreaksUsed] = useState(false);
```

- [ ] **Step 3: Freeze the timer when paused**

In the countdown `useEffect`, add `paused` to the guard and the dependency array. Change the early return to:
```ts
    if (screen !== 'test' || paused) return;
```
and the deps line to:
```ts
  }, [screen, secIdx, modIdx, paused]);
```
(The effect's existing `return stopTimer` cleanup stops the running interval when `paused` flips to `true`.)

- [ ] **Step 4: Add `pause` / `resume` (guarded), and reset in lifecycle**

Add (near `submitModule` / `newTest`):
```ts
  const pause = useCallback(() => {
    if (!breaksEnabled || screen !== 'test' || paused) return;
    setBreaksUsed(true);
    setPaused(true);
  }, [breaksEnabled, screen, paused]);

  const resume = useCallback(() => {
    setPaused((p) => (p ? false : p));
  }, []);
```
In `start()`, after computing the test (where `setScreen('test')` is set up), force-reset:
```ts
    setBreaksEnabled(testLength === 'short' ? false : breaksEnabled);
    setPaused(false);
    setBreaksUsed(false);
```
(Place these alongside the other `setSecIdx(0)` / `setScreen('test')` resets. `breaksEnabled` keeps its toggle value for full tests, forced false for short.)
In `newTest()`, add:
```ts
    setPaused(false);
    setBreaksUsed(false);
```

- [ ] **Step 5: Pass `breaksUsed` into the save payload**

In the save effect, change:
```ts
    const payload = toAttemptPayload(test, responses, results, testLength);
```
to:
```ts
    const payload = toAttemptPayload(test, responses, results, testLength, breaksUsed);
```

- [ ] **Step 6: Export the new fields**

Add `breaksEnabled, setBreaksEnabled, paused, pause, resume, breaksUsed` to the returned object.

- [ ] **Step 7: Verify type-check + payload check**

Run: `pnpm type-check` (expect no errors) and `pnpm dlx tsx scripts/check-payload.ts` (expect `ALL CHECKS PASSED`).

- [ ] **Step 8: Commit**

```bash
git add app/hooks/useTestSession.ts
git commit -m "feat(session): pause/resume with frozen timer + breaksUsed tracking"
```

---

## Chunk 2: UI + display + docs

### Task 5: StartScreen — "Allow breaks" toggle (full only)

**Files:**
- Modify: `app/components/StartScreen.tsx`

- [ ] **Step 1: Add props (optional w/ defaults so this commit stays green before Task 8 wires them)**

Add to `StartScreenProps`:
```ts
  breaksEnabled?: boolean;
  setBreaksEnabled?: (b: boolean) => void;
```
Destructure them with defaults in the component signature: `breaksEnabled = false, setBreaksEnabled = () => {},`.

- [ ] **Step 2: Render the toggle, full tests only**

Immediately after the Test-length button row (after the closing `</div>` of the `flex` block ending ~line 60), add:
```tsx
          {testLength === 'full' && (
            <label className="mb-[18px] flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={breaksEnabled}
                onChange={(e) => setBreaksEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>
                Allow breaks — show a Pause button so you can stop the clock and take a
                break. Leave unchecked for a strict, real-test timed run.
              </span>
            </label>
          )}
```

- [ ] **Step 3: Verify type-check**

Run: `pnpm type-check`. Expected: no errors (props are optional-with-defaults, so this is green even before Task 8 supplies the real values).

- [ ] **Step 4: Commit**

```bash
git add app/components/StartScreen.tsx
git commit -m "feat(ui): Allow breaks toggle on the full test start screen"
```

---

### Task 6: PausedOverlay component (new)

**Files:**
- Create: `app/components/PausedOverlay.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { Button } from '@/app/components/ui/button';

// Full-screen overlay shown while a test is paused. Covers ALL test content
// (passage, question, choices, calculator/reference, nav) so a break cannot be
// used to keep working. Its only control is Resume.
export function PausedOverlay({ onResume }: { onResume: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Test paused"
    >
      <h2 className="text-2xl font-semibold text-slate-800">Paused</h2>
      <p className="max-w-sm text-center text-slate-500">
        Your timer is stopped. Take your time — the question is hidden until you resume.
      </p>
      <Button onClick={onResume}>Resume test</Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check**

Run: `pnpm type-check`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/PausedOverlay.tsx
git commit -m "feat(ui): PausedOverlay component"
```

---

### Task 7: TestScreen — Pause button + overlay

**Files:**
- Modify: `app/components/TestScreen.tsx`

- [ ] **Step 1: Add props (optional w/ defaults so this commit stays green before Task 8 wires them)**

Add to `TestScreenProps`:
```ts
  breaksEnabled?: boolean;
  paused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
```
Destructure them with defaults in the component: `breaksEnabled = false, paused = false, onPause = () => {}, onResume = () => {},`.

- [ ] **Step 2: Import the overlay**

```ts
import { PausedOverlay } from './PausedOverlay';
```

- [ ] **Step 3: Render a Pause button (only when breaks enabled)**

Inside the content container (e.g. just before the `{isMath && (...calculator/reference buttons...)}` block, ~line 79), add:
```tsx
        {breaksEnabled && (
          <div className="mb-3">
            <button
              type="button"
              onClick={onPause}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-blue-500 hover:bg-blue-50"
            >
              ⏸ Pause
            </button>
          </div>
        )}
```

- [ ] **Step 4: Mount the overlay when paused**

At the end of the returned fragment, after the calculator/reference lines (~line 124), add:
```tsx
      {paused && <PausedOverlay onResume={onResume} />}
```

- [ ] **Step 5: Verify type-check**

Run: `pnpm type-check`. Expected: no errors (props optional-with-defaults; Task 8 supplies real values).

- [ ] **Step 6: Commit**

```bash
git add app/components/TestScreen.tsx
git commit -m "feat(ui): Pause button + PausedOverlay on the test screen"
```

---

### Task 8: SatPractice — thread the props

**Files:**
- Modify: `app/components/SatPractice.tsx`

- [ ] **Step 1: Pass toggle props to StartScreen**

In the `<StartScreen .../>` JSX, add:
```tsx
        breaksEnabled={s.breaksEnabled}
        setBreaksEnabled={s.setBreaksEnabled}
```

- [ ] **Step 2: Pass pause props to TestScreen**

In the `<TestScreen .../>` JSX, add:
```tsx
        breaksEnabled={s.breaksEnabled}
        paused={s.paused}
        onPause={s.pause}
        onResume={s.resume}
```

- [ ] **Step 3: Verify type-check + build**

Run: `pnpm type-check` then `pnpm build`. Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add app/components/SatPractice.tsx
git commit -m "feat(ui): wire pause props through SatPractice"
```

---

### Task 9: ResultsScreen — "taken with breaks" tag

**Files:**
- Modify: `app/components/ResultsScreen.tsx`
- Modify: `app/components/SatPractice.tsx` (pass the prop)

- [ ] **Step 1: Add the prop**

In `ResultsScreenProps`, add `breaksUsed: boolean;`. Destructure it.

- [ ] **Step 2: Render the tag**

Near the existing `test.name` chip at the top of the card, add (after that chip):
```tsx
          {breaksUsed && (
            <span className="ml-2 inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Taken with breaks
            </span>
          )}
```

- [ ] **Step 3: Pass it from SatPractice**

In the `<ResultsScreen .../>` JSX, add `breaksUsed={s.breaksUsed}`.

- [ ] **Step 4: Verify type-check**

Run: `pnpm type-check`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/ResultsScreen.tsx app/components/SatPractice.tsx
git commit -m "feat(ui): 'taken with breaks' tag on results"
```

---

### Task 10: Read path — `breaks_used` in queries + dashboard/review tags

**Files:**
- Modify: `app/lib/persistence/queries.ts`
- Modify: `app/components/AttemptCard.tsx`
- Modify: `app/(app)/dashboard/attempts/[id]/page.tsx`

- [ ] **Step 1: Add the column to the query type + select**

In `queries.ts`, add to `AttemptSummary`:
```ts
  breaks_used: boolean;
```
and append `, breaks_used` to the `SUMMARY_COLUMNS` string (used by both `listAttempts` and `getAttempt`).

- [ ] **Step 2: Tag in the dashboard list row**

In `AttemptCard.tsx`, in the bottom flex-wrap row (after the `test_length === 'short'` badge, ~line 53), add:
```tsx
        {attempt.breaks_used && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            With breaks
          </span>
        )}
```

- [ ] **Step 3: Tag on the attempt-detail page**

In `app/(app)/dashboard/attempts/[id]/page.tsx`, near where the attempt's test_length / score header is rendered, add a conditional tag when `attempt.breaks_used` is true (match the existing badge styling on that page; reuse the amber `With breaks` span). If unsure of the exact element, place it next to the test-length label in the header.

- [ ] **Step 4: Verify type-check + build**

Run: `pnpm type-check` then `pnpm build`. Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/lib/persistence/queries.ts app/components/AttemptCard.tsx "app/(app)/dashboard/attempts/[id]/page.tsx"
git commit -m "feat(ui): surface breaks_used in dashboard + attempt review"
```

---

### Task 11: Docs + full verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a CLAUDE.md gotcha**

Under the persistence/adaptive gotchas, add a bullet:
> **Full-test pause ("Allow breaks") is a per-session flag, not a test type.** `useTestSession` holds `breaksEnabled` (start-screen toggle, default OFF, forced false for short), `paused`, and `breaksUsed`. Pausing freezes the clock by adding `paused` to the countdown effect's guard+deps — the interval is the sole mutator of `remaining[][]`, so suspending it freezes time with no separate accounting (`pause()` must NOT call `stopTimer()` — the effect cleanup does). `breaks_used` threads payload → `save_attempt` → `test_attempts` and is **informational only — never read by `sat.scale_section` or any scoring path**.

- [ ] **Step 2: Run the full verification battery**

Run, expecting all to pass:
```
pnpm dlx tsx scripts/check-payload.ts
pnpm type-check
pnpm build
```

- [ ] **Step 3: Manual verification (record results)**

1. Full test, "Allow breaks" ON → during a module, click Pause → confirm timer is frozen (note the seconds, wait, confirm unchanged) and all content is hidden → Resume → timer continues from the frozen value.
2. Submit the test → results show "Taken with breaks"; dashboard row + attempt review show "With breaks".
3. Full test, "Allow breaks" OFF → no Pause button; saved attempt has `breaks_used = false`, no tag.
4. Quick (short) test → no toggle, no Pause button.

- [ ] **Step 4: Commit + push**

```bash
git add CLAUDE.md
git commit -m "docs: document full-test pause / breaks_used"
git push origin main
```

---

## Done criteria
- Full test with breaks ON can be paused (clock frozen, content hidden) and resumed.
- Strict full test (breaks OFF) and short tests are unchanged — no pause surface.
- Saved attempts record `breaks_used`; the tag shows on results, dashboard, and review.
- Scoring is unchanged; `breaks_used` is never read by a scoring path.
- `check-payload.ts`, `type-check`, and `build` all pass; manual checks recorded.
