# SAT Prep — Persistence Sub-Project Design

**Date:** 2026-05-21
**Status:** Approved for plan-writing
**Sub-project:** #4 of 7 — Persistence (test history)
**Audience:** Future implementer (human or AI) building attempt persistence
**Builds on:** Foundation (#1, `post-foundation`), Auth (#3, `post-auth`), AI Question Generation (#2, `post-ai`)

---

## 1. Context: where this fits

The SAT app plays a test entirely in browser memory. `useTestSession` holds the
`test`, the `responses` array, and computes a `Results` object when the user
submits; `ResultsScreen` renders the score and an optional per-question review.
Nothing is written to a database. Close the tab and the attempt is gone. The
`/dashboard` page is a placeholder that says test history "will appear here once
the Persistence sub-project lands."

This sub-project makes a submitted test **durable**. On submission the full
attempt — the score, and every question with the user's answer — is written to
Supabase. `/dashboard` becomes a list of the user's past attempts. Each list
entry opens a **read-only review** of that attempt, reusing the existing
`ReviewItem` component so the user can see exactly which questions they missed.

Auth (#3) is done, so every attempt belongs to a known `auth.users` id. AI (#2)
is done, so a test's questions may be `source='seed'` or `source='ai'`, drawn
from `sat.questions` (with an in-code `BANK` fallback).

This sub-project does **not** build analytics (score trends, per-skill accuracy
charts) — that is sub-project #5. It deliberately stores the per-question detail
in a shape (`sat.attempt_responses`, one row per question, with `skill` and
`question_id`) that makes #5 a straightforward SQL aggregation.

---

## 2. Scope

### 2.1 In scope

- **`sat.test_attempts`** table — one row per submitted test (score, date, summary).
- **`sat.attempt_responses`** table — one row per question in an attempt, snapshotting
  the question exactly as it was presented plus the user's answer.
- **`sat.save_attempt(p_attempt, p_responses)`** RPC — inserts the attempt and all
  its responses in one transaction, returns the new attempt id.
- **`toAttemptPayload()`** — a pure function mapping the in-memory `Test` +
  `responses` + `Results` into the persisted payload shape.
- **`saveAttempt()`** server action — validates the payload (zod) and calls the RPC.
- **`useTestSession` save hook-in** — fires the save exactly once when a test is
  submitted; exposes a `saveStatus`.
- **`ResultsScreen` save indicator** — a small "saved to your dashboard" line.
- **`/dashboard`** — replaced placeholder: the user's attempt history as a list.
- **`/dashboard/attempts/[id]`** — a read-only review of one past attempt.
- **`AttemptCard`** — the list-row component for the history list.
- Read helpers (`listAttempts`, `getAttempt`) for the two dashboard pages.
- Docs sync + a `post-persistence` git tag.

### 2.2 Out of scope (explicitly deferred)

- **Analytics** — score trends over time, per-skill accuracy, weak-area
  detection, charts. This is sub-project #5. `/dashboard` here is a plain list.
- **Resuming an in-progress test.** A test is persisted only on submission;
  closing the tab mid-test loses that session. (Stakeholder decision D2.)
- **Editing or deleting a past attempt.** Attempts are immutable once written.
- **Per-question difficulty / time-per-question telemetry.** Not modelled.
- **Admin views of other users' attempts** — sub-project #6.
- **Automated test suites** — verification is `pnpm type-check` + `pnpm lint` +
  `pnpm build` + a scripted check + MCP SQL checks + a manual click-through
  (matches Foundation Decision D8 and the AI sub-project).

### 2.3 Acceptance criteria

1. `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm type-check`, `pnpm lint` all succeed.
2. `sat.test_attempts` and `sat.attempt_responses` exist with RLS enabled, a
   `select`-only policy scoped to `auth.uid()`, and no write policy.
3. Submitting a test writes exactly one `test_attempts` row and one
   `attempt_responses` row per question, in a single transaction.
4. A user can only ever read their own attempts and responses (RLS verified
   cross-user).
5. `/dashboard` lists the signed-in user's attempts, newest first, with a
   sensible empty state when there are none.
6. Clicking an attempt opens `/dashboard/attempts/[id]`, showing every question
   with the user's answer marked correct / incorrect / skipped, the correct
   answer, and the explanation — matching what `ResultsScreen`'s review showed.
7. Visiting another user's attempt id (or a non-existent id) yields a 404, not
   another user's data and not a crash.
8. A test built from the in-code `BANK` fallback persists the same as a
   pool-drawn test.
9. If the save fails, the user still sees their results; the failure is surfaced
   (a non-blocking message) and logged.

---

## 3. Architecture decisions (locked)

Made through brainstorming with the stakeholder on 2026-05-21.

| # | Decision | Rationale |
|---|---|---|
| D1 | **The `/dashboard` review supports per-attempt drill-down**, not just a score list. Each past attempt opens a read-only review of every question. | Stakeholder requirement — the learning loop is "see which questions you missed and why." It also determines that `attempt_responses` must store the user's *chosen answer*, not merely a correct/incorrect flag. |
| D2 | **A test is persisted only on submission ("save on submit only").** No mid-test autosave, no resume. | Stakeholder decision. Keeps the test purely client-side until the end — no in-progress status field, no autosave debounce, no resume UI. Resume-later can be its own future feature. |
| D3 | **Per-question detail lives in a separate `sat.attempt_responses` table** (one row per question), not as a `jsonb` blob on `test_attempts`. | Stakeholder decision. Analytics (#5, next) wants per-skill accuracy and per-question difficulty; a real table makes those a `GROUP BY skill` / `GROUP BY question_id`, where a jsonb blob would force `jsonb_array_elements` unnesting and awkward cross-user aggregation. |
| D4 | **Each response row snapshots the question as it was presented** — the (shuffled) `choices`, the (rewritten) `answer_index`, the `prompt`, `passage`, `explanation`, `source` — rather than only storing `question_id`. | `buildTest` shuffles every question's choices per test and rewrites `answerIndex` (`shuffleChoices` in `test.ts`). So `chosen_index` only has meaning against *that test's* choice order — a join back to `sat.questions` would give the original order and mis-render the answer. Snapshotting also makes a review immune to the AI pool later recycling, regenerating, or deleting a question. `question_id` and `skill` are kept too, for analytics. |
| D5 | **Writes go through a `security definer` RPC `sat.save_attempt`; the tables have a `select`-only RLS policy and no write policy.** | Mirrors the existing `sat.questions` + `sat.draw_questions` pattern exactly (AI sub-project §6.1). One controlled write path, transactional (attempt + responses succeed or fail together — no orphan attempt with no responses), and the function sets `user_id := auth.uid()` itself so the client can never write another user's id. |
| D6 | **The save is triggered from a `useEffect` that fires when `screen` becomes `'results'`**, guarded by a ref so it runs once. | The effect runs after render, reading *committed* `responses`/`results` state — no stale-closure risk that calling the save inside the `finish()` event handler would have. The ref guard (reset by `newTest()`) prevents a double-write on re-render. |
| D7 | **The review page reuses the existing `ReviewItem` component**, reconstructing a `Question`-shaped object from each snapshot row. | `ReviewItem` already renders passage, prompt, the chosen vs. correct answer, and the explanation with the correct `source`-based escaping (seed → trusted HTML, ai → escaped text). No new review UI is needed; the snapshot columns map 1:1 onto `Question`. |
| D8 | **No automated tests** (matches Foundation D8 and the AI sub-project). Verification is type-check + lint + build + a scripted check of the pure `toAttemptPayload` + MCP SQL checks + a manual click-through. | Project convention — this codebase has no test runner; introducing one for this sub-project would be inconsistent. The one genuinely pure unit (`toAttemptPayload`) is exercised by a small `tsx` script in the existing `scripts/` style. |

---

## 4. Target file structure

Files **created** or **modified** by this sub-project. Everything else from
`post-ai` is unchanged.

```
sat-app/
├── README.md                                   # MODIFIED: persistence section
├── CLAUDE.md                                    # MODIFIED: sub-project status
│
├── supabase/migrations/
│   └── 20260521050000_sat_test_attempts.sql     # CREATED: 2 tables + RLS + save_attempt RPC
│
├── scripts/
│   └── check-payload.ts                         # CREATED: scripted check of toAttemptPayload
│
├── app/
│   ├── lib/persistence/
│   │   ├── payload.ts                           # CREATED: AttemptPayload type + toAttemptPayload()
│   │   ├── schema.ts                            # CREATED: zod attemptPayloadSchema
│   │   ├── actions.ts                           # CREATED: 'use server' saveAttempt()
│   │   └── queries.ts                           # CREATED: listAttempts(), getAttempt(), types, mappers
│   │
│   ├── hooks/useTestSession.ts                  # MODIFIED: save effect, savedRef, saveStatus
│   │
│   ├── components/
│   │   ├── SatPractice.tsx                      # MODIFIED: pass saveStatus to ResultsScreen
│   │   ├── ResultsScreen.tsx                    # MODIFIED: render the save indicator
│   │   ├── ReviewItem.tsx                       # MODIFIED: stale header comment only — no behavior change
│   │   └── AttemptCard.tsx                      # CREATED: a history-list row
│   │
│   └── (app)/dashboard/
│       ├── page.tsx                             # MODIFIED: placeholder → history list
│       └── attempts/[id]/page.tsx               # CREATED: read-only attempt review
│
└── docs/superpowers/
    ├── specs/2026-05-21-sat-app-persistence-design.md          # this document
    └── plans/2026-05-21-sat-app-persistence-implementation.md  # written next
```

---

## 5. Implementation path (ordered steps)

Each numbered step is one logical commit.

### Step 1 — Data model

Write `supabase/migrations/20260521050000_sat_test_attempts.sql` (full SQL in
§6.1) and apply it via the Supabase MCP (the Foundation/Auth/AI path — the
implementer writes and commits the file, the controller applies it). Verify the
two tables, RLS posture, and the RPC.

### Step 2 — Payload mapping + its check

`app/lib/persistence/payload.ts` — the `AttemptPayload`/`AttemptResponsePayload`
types and the pure `toAttemptPayload(test, responses, results, testLength)`
function. `scripts/check-payload.ts` — builds a small `Test` via `buildTest`,
runs `toAttemptPayload`, and asserts the shape and a few values (counts,
`isCorrect`, skipped → `chosenIndex: null`). Written alongside `payload.ts` so
the function is exercised before it is wired in. It follows the existing
`scripts/seed-questions.ts` pattern — run with `tsx`, outside the Next.js build,
so importing `buildTest` into it never reaches the client bundle.

### Step 3 — Validation + server action

`app/lib/persistence/schema.ts` — the zod `attemptPayloadSchema` matching
`AttemptPayload`. `app/lib/persistence/actions.ts` — the `'use server'`
`saveAttempt(payload)`: validate, call the `sat.save_attempt` RPC via the SSR
server client, return `{ ok: true, id }` or `{ ok: false, error }`.

### Step 4 — Save hook-in

`useTestSession` — add a `savedRef`, a `saveStatus` field, and a `useEffect` that
on `screen === 'results'` builds the payload and calls `saveAttempt`. `newTest()`
resets the ref and status. `SatPractice` passes `saveStatus` through;
`ResultsScreen` renders the small indicator line.

### Step 5 — Dashboard history list

`app/lib/persistence/queries.ts` — `listAttempts()` plus the `AttemptSummary`
type. `app/components/AttemptCard.tsx` — one history row. `/dashboard/page.tsx` —
replace the placeholder with the list (and the empty state).

### Step 6 — Attempt review page

Extend `queries.ts` with `getAttempt(id)`, the `AttemptDetail` type, and the
`responseToQuestion` mapper. `app/(app)/dashboard/attempts/[id]/page.tsx` — the
read-only review, grouped by section, rendered through `ReviewItem`.

### Step 7 — Verification, docs, tag

Run the §11 checks, update `README.md` + `CLAUDE.md`, tag `post-persistence`.

---

## 6. Data model

### 6.1 Migration — `supabase/migrations/20260521050000_sat_test_attempts.sql`

```sql
-- Persistence sub-project — submitted-test history + per-question detail.

-- ---- sat.test_attempts: one row per submitted test ----------------------
create table if not exists sat.test_attempts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  student_name      text not null,
  test_length       text not null check (test_length in ('short','full')),
  total_correct     int  not null check (total_correct >= 0),
  total_questions   int  not null check (total_questions > 0),
  scaled_score      int  not null check (scaled_score between 400 and 1600),
  section_breakdown jsonb not null   -- [{ name, correct, total }, ...]
);
create index if not exists test_attempts_user_created_idx
  on sat.test_attempts (user_id, created_at desc);

alter table sat.test_attempts enable row level security;

-- A user may read only their own attempts. There is intentionally NO write
-- policy: even though Supabase grants table privileges to `authenticated` on
-- exposed-schema tables, RLS with no write policy denies all writes. The only
-- write path is the save_attempt RPC (security definer → bypasses RLS).
create policy "test_attempts_select_own" on sat.test_attempts
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---- sat.attempt_responses: one row per question in an attempt ----------
-- Each row snapshots the question AS PRESENTED (choices are shuffled per test;
-- chosen_index is meaningless against the original sat.questions row).
create table if not exists sat.attempt_responses (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid not null references sat.test_attempts (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  section_key   text not null check (section_key in ('rw','math')),
  section_name  text not null,
  position      int  not null check (position >= 0),   -- 0-indexed within section
  question_id   text not null,                         -- original sat.questions / BANK id
  skill         text not null,
  source        text not null check (source in ('seed','ai')),
  passage       text,
  prompt        text not null,
  choices       jsonb not null,                        -- string[] AS PRESENTED
  answer_index  int  not null check (answer_index >= 0),
  chosen_index  int  check (chosen_index >= 0),         -- null = skipped
  is_correct    boolean not null
);
-- (attempt_id, position) serves both the getAttempt filter and its ORDER BY.
create index if not exists attempt_responses_attempt_idx
  on sat.attempt_responses (attempt_id, position);
-- user_id index supports the RLS `using` clause.
create index if not exists attempt_responses_user_idx
  on sat.attempt_responses (user_id);

alter table sat.attempt_responses enable row level security;

create policy "attempt_responses_select_own" on sat.attempt_responses
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---- sat.save_attempt: transactional insert of an attempt + its responses
-- security definer: the tables have no write policy, so this controlled path
-- is the only writer. It sets user_id := auth.uid() itself — the client never
-- supplies it. A plpgsql function is one transaction: the attempt and every
-- response row commit together or not at all (no orphan attempt).
create or replace function sat.save_attempt(p_attempt jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  insert into sat.test_attempts (
    user_id, student_name, test_length,
    total_correct, total_questions, scaled_score, section_breakdown
  ) values (
    v_user,
    p_attempt ->> 'studentName',
    p_attempt ->> 'testLength',
    (p_attempt ->> 'totalCorrect')::int,
    (p_attempt ->> 'totalQuestions')::int,
    (p_attempt ->> 'scaledScore')::int,
    p_attempt -> 'sectionBreakdown'
  )
  returning id into v_id;

  insert into sat.attempt_responses (
    attempt_id, user_id, section_key, section_name, position,
    question_id, skill, source, passage, prompt, choices,
    answer_index, chosen_index, is_correct
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
    (r ->> 'chosenIndex')::int,        -- JSON null -> SQL NULL
    (r ->> 'isCorrect')::boolean
  from jsonb_array_elements(p_responses) as r;

  return v_id;
end;
$$;

grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;
```

Notes:
- `save_attempt` is `security definer` so it writes despite the tables' no-write
  RLS — the same pattern `draw_questions` uses for `served_questions`. It scopes
  every insert to `auth.uid()`. `set search_path = ''` forces fully-qualified
  names.
- `(r ->> 'chosenIndex')::int` — `->>` on a JSON `null` (or an absent key)
  returns SQL `NULL`, and `NULL::int` is `NULL`, so a skipped question persists
  `chosen_index = NULL` with no special-casing.
- `student_name` is `not null` with no empty-string check — that is safe only
  because `start()` already rejects an empty trimmed name and `buildTest`
  defaults a blank name to `'Student'`, so `test.name` is always non-empty.
- The migration is applied by the controller via
  `mcp__claude_ai_Supabase__apply_migration`; the implementer writes and commits
  the file.

### 6.2 Why snapshot, not reference (Decision D4)

`buildTest` calls `shuffleChoices` on every question, which reorders `choices`
and rewrites `answerIndex` to the new position. A user's `responses[si][qi]` is
an index into *that shuffled order*. If `attempt_responses` stored only
`question_id` and `chosen_index`, the review page would join `sat.questions`,
get the *original* choice order, and render the user's answer and the "correct"
answer against the wrong array — silently wrong. Snapshotting the presented
`choices` + `answer_index` is therefore required for correctness, and as a bonus
makes a review permanently accurate even if the AI pool later changes or deletes
that question. `question_id` and `skill` are still stored so Analytics (#5) can
aggregate per question and per skill.

---

## 7. Payload, validation, and the save path

### 7.1 `AttemptPayload` + `toAttemptPayload` (`app/lib/persistence/payload.ts`)

```ts
import type { SectionKey } from '@/app/lib/questions';
import type { Test, Results, TestLength } from '@/app/lib/test';

export interface AttemptResponsePayload {
  sectionKey: SectionKey;
  sectionName: string;
  position: number;
  questionId: string;
  skill: string;
  source: 'seed' | 'ai';
  passage: string | null;
  prompt: string;
  choices: string[];
  answerIndex: number;
  chosenIndex: number | null;   // null = skipped
  isCorrect: boolean;
}

export interface AttemptPayload {
  studentName: string;
  testLength: TestLength;
  totalCorrect: number;
  totalQuestions: number;
  scaledScore: number;
  sectionBreakdown: { name: string; correct: number; total: number }[];
  responses: AttemptResponsePayload[];
}

// Pure: maps an in-memory finished test into the persisted payload shape.
export function toAttemptPayload(
  test: Test,
  responses: (number | null)[][],
  results: Results,
  testLength: TestLength,
): AttemptPayload;
```

Every field has a precise source — `toAttemptPayload` reads only from its four
arguments, no I/O:

| Payload field | Source |
|---|---|
| `studentName` | `test.name` (`buildTest` sets it to the entered name, or `'Student'` if blank — so it is never empty) |
| `testLength` | the `testLength` argument (the *only* field not derivable from `test`/`results` — `Test` does not carry it) |
| `totalCorrect` / `totalQuestions` | summed from `results.perSection` (`correct` / `total`) |
| `scaledScore` | `results.scaled` |
| `sectionBreakdown` | `results.perSection` directly — it is already `{ name, correct, total }[]` |
| per response `sectionKey` / `sectionName` | `test.sections[si].key` / `.name` |
| per response `position` | `qi` (the 0-indexed question position within the section) |
| per response `questionId` / `skill` / `source` / `passage` / `prompt` / `choices` / `answerIndex` | the corresponding fields of `q = test.sections[si].questions[qi]` (`q` is the *shuffled* question, so `choices`/`answerIndex` are as presented) |
| per response `chosenIndex` | `responses[si][qi]` (`null` = skipped) |
| per response `isCorrect` | `chosenIndex === q.answerIndex` |

`toAttemptPayload` is pure, so `scripts/check-payload.ts` exercises it directly.

### 7.2 `attemptPayloadSchema` (`app/lib/persistence/schema.ts`)

A zod schema matching `AttemptPayload`: `testLength` an enum, the counts
non-negative integers, `scaledScore` in `400..1600`, `responses` a non-empty
array of objects with `chosenIndex` nullable, `choices` a non-empty string
array. The server action rejects anything that fails it before touching the DB.

### 7.3 `saveAttempt` server action (`app/lib/persistence/actions.ts`)

`'use server'`. Signature `saveAttempt(payload: AttemptPayload): Promise<{ ok:
true; id: string } | { ok: false; error: string }>`. It:
1. Parses `payload` with `attemptPayloadSchema`; on failure returns
   `{ ok: false, error }`.
2. Gets the SSR server client (`app/lib/supabase/server.ts`) — authenticated as
   the user via cookies.
3. Calls `supabase.schema('sat').rpc('save_attempt', { p_attempt, p_responses })`
   where `p_attempt` is the payload's scalar fields + `sectionBreakdown` and
   `p_responses` is `payload.responses`.
4. Returns `{ ok: true, id }` on success, `{ ok: false, error }` on RPC error.

The action never trusts a client-supplied `user_id` — there is none in the
payload; the RPC derives it from `auth.uid()`.

### 7.4 Save hook-in (`useTestSession`)

- New `savedRef = useRef(false)`.
- New `saveStatus: 'idle' | 'saving' | 'saved' | 'error'` state, exposed on the
  `TestSession` interface.
- A `useEffect` keyed on `screen`: when `screen === 'results'`, `test` is set,
  and `!savedRef.current`, it sets `savedRef.current = true`, sets `saveStatus`
  to `'saving'`, builds the payload via `toAttemptPayload(test, responses,
  results, testLength)`, awaits `saveAttempt`, and sets `saveStatus` to
  `'saved'` or `'error'` (logging the error). Running in the effect (not in
  `finish()`) guarantees committed `responses`/`results` and avoids a stale
  closure.
- `newTest()` resets `savedRef.current = false` and `saveStatus = 'idle'`.

`SatPractice` passes `saveStatus` to `ResultsScreen`, which renders a small
non-blocking line: `saving` → "Saving to your dashboard…", `saved` → "Saved to
your dashboard ✓", `error` → "Couldn't save this attempt — your history may be
incomplete." A save failure never blocks the results view (acceptance #9).

---

## 8. Dashboard pages

### 8.1 Read helpers (`app/lib/persistence/queries.ts`)

Server-only module. Uses the SSR server client; RLS scopes every read to the
signed-in user.

- `listAttempts(): Promise<AttemptSummary[]>` — selects `id, created_at,
  student_name, test_length, total_correct, total_questions, scaled_score,
  section_breakdown` from `sat.test_attempts`, ordered `created_at desc, id
  desc` (the `id` tie-break keeps the order stable for attempts saved in the
  same millisecond).
- `getAttempt(id): Promise<AttemptDetail | null>` — **two queries**: first the
  one `test_attempts` row via `.eq('id', id).maybeSingle()`; if that is `null`
  (not found, or RLS hid it) return `null` immediately. Otherwise a second query
  for that attempt's `attempt_responses` `.eq('attempt_id', id).order('position')`.
  Two queries (rather than a foreign-key embed) keep the not-found check
  unambiguous — it is decided solely by the attempt query, so a real attempt
  with zero responses is never mistaken for missing. If `id` is not a valid
  uuid, the first query errors; that error is caught and treated as not-found.
- `responseToQuestion(row)` — maps an `attempt_responses` row to the `Question`
  shape `ReviewItem` expects (`passage: row.passage ?? undefined`, `answerIndex:
  row.answer_index`, `source` cast, `choices` guarded to an array — same posture
  as the existing `rowToQuestion`).
- Types `AttemptSummary`, `AttemptResponseRow`, `AttemptDetail` (`{ attempt:
  AttemptSummary; responses: AttemptResponseRow[] }`).

### 8.2 History list — `/dashboard/page.tsx`

Server component. Keeps the `getOrCreateProfile()` greeting. Calls
`listAttempts()`.
- **Empty:** a friendly empty state — "You haven't taken a test yet." with a
  link to `/` (the practice app).
- **Non-empty:** a list of `AttemptCard`s. Each card: the date (`created_at`,
  formatted), a "Short" / "Full" badge from `test_length`, the `scaled_score`
  shown prominently, `total_correct`/`total_questions`, and the per-section
  `correct/total` from `section_breakdown` as small chips. The whole card links
  to `/dashboard/attempts/[id]`.

`AttemptCard` is a plain presentational component (no hooks) — it renders inside
the server component fine.

### 8.3 Attempt review — `/dashboard/attempts/[id]/page.tsx`

Server component, `params` carries `id`. Calls `getAttempt(id)`; if `null`, calls
`notFound()` (Next renders the 404) — this covers both another user's id (RLS
returns nothing) and a non-existent / malformed id (acceptance #7).

Renders a header (a back link to `/dashboard`, the date, the scaled score, the
`total_correct`/`total_questions`, the section breakdown) and then the questions
grouped by section. Responses come ordered by `position`; the page groups them by
`section_key` and renders the sections in `SECTION_ORDER` (`rw` then `math`) so
the review reads in the same order as the test. Each response renders through
`<ReviewItem question={responseToQuestion(row)} chosenIndex={row.chosen_index} />`.

`ReviewItem` is a `'use client'` component but takes only serializable props, so
a server component renders it across the boundary with **no behavior change** to
`ReviewItem`. Its existing `source`-based explanation rendering (seed → trusted
HTML, ai → escaped text) carries over unchanged on the snapshotted `source`.

One trivial cleanup while reusing it: `ReviewItem`'s header comment (lines
11–13) still says "The AI sub-project (#2) MUST replace this with a sanitizer…"
— but #2 already shipped that fix (the `source` branch). The comment is stale
and is corrected here to describe the shipped behavior. No code change.

---

## 9. Security

- **Row isolation.** Both tables have RLS enabled and a `select`-only policy
  `(select auth.uid()) = user_id`. A user can never read another user's
  attempts or responses; the review page's `getAttempt` of someone else's id
  returns `null` → 404.
- **Controlled write path.** No write RLS policy exists on either table, so all
  direct `INSERT`/`UPDATE`/`DELETE` from `authenticated` is denied regardless of
  any auto-granted table privileges (the `sat.questions` precedent). The sole
  writer is `sat.save_attempt`, `security definer`, which sets `user_id :=
  auth.uid()` itself — a client cannot write a row attributed to another user.
- **No service-role key involved.** Unlike the AI generation endpoint, this
  sub-project's writes are user-initiated and run as the user through the RPC;
  `SUPABASE_SERVICE_ROLE_KEY` is not used here.
- **Data integrity (accepted limitation).** The *entire* attempt payload is
  computed client-side and the RPC inserts it verbatim — it does not re-derive
  anything. So a determined user could craft not just an inflated
  `scaled_score` but also bogus per-row `is_correct` / `answer_index` values,
  for *their own* history. This is a personal practice app — falsifying your own
  practice data only misleads yourself, and RLS still prevents touching anyone
  else's. Server-side re-scoring and re-grading are deferred; documented in §10.
- **No new XSS surface.** Explanations are rendered through the existing
  `ReviewItem`, which escapes `source='ai'` content and only trusts
  `source='seed'` HTML. The snapshot stores `source`, so this holds on the
  review page.

---

## 10. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The save fails (network, RPC error) after the user finishes a test. | Low | Low | `saveStatus='error'` shows a non-blocking message and the failure is logged; the user still sees full results. The attempt is simply absent from history. No retry in v1 — documented. |
| A user fabricates an inflated score by calling the RPC directly. | Low | Low | RLS confines it to their own data; a practice score has no competitive value. Server-side re-scoring deferred (§9). |
| Choice-shuffle mismatch makes a review render the wrong answer. | — | High if unaddressed | Closed by D4 / §6.2 — each response snapshots the presented `choices` + `answer_index`, so `chosen_index` always lines up. |
| A double-save writes two attempts for one test. | Low | Low | The `savedRef` guard (D6) fires the effect once per `results` screen; `newTest()` resets it. |
| Malformed `[id]` in the review URL crashes the page. | Medium | Low | `getAttempt` catches the Postgres uuid error and returns `null`; the page calls `notFound()`. |
| Migration touches the shared Property Ledger DB. | Low | Medium | Additive, confined to the `sat` schema (two tables, one function, indexes). Applied + verified via MCP, as Foundation/Auth/AI migrations were. |
| A full test (≈49 questions, with passages) makes a large RPC payload. | Low | Low | Well within Postgres jsonb / request limits; one round trip. |

---

## 11. Verification (run at Step 7)

- [ ] `pnpm type-check`, `pnpm lint`, `pnpm build` — zero errors.
- [ ] `execute_sql`: `sat.test_attempts` and `sat.attempt_responses` exist; RLS
      enabled on both; each has exactly one `select` policy and no write policy;
      `sat.save_attempt` exists.
- [ ] `scripts/check-payload.ts` runs and its assertions on `toAttemptPayload`
      pass (counts, `isCorrect`, skipped → `chosenIndex: null`).
- [ ] `pnpm dev`: sign in, take and submit a Quick test; `ResultsScreen` shows
      "Saved to your dashboard ✓".
- [ ] `execute_sql`: exactly one new `test_attempts` row and one
      `attempt_responses` row per question; `total_questions` matches the count.
- [ ] `/dashboard` lists that attempt, newest first; a brand-new user sees the
      empty state.
- [ ] Clicking the attempt opens `/dashboard/attempts/[id]`; every question
      shows the user's answer as correct / incorrect / skipped, the correct
      answer, and the explanation — matching the post-submit review.
- [ ] Cross-user RLS: with two users, user B's `getAttempt` of user A's id
      returns nothing → the page 404s. A non-existent / malformed id also 404s.
- [ ] A test forced onto the in-code `BANK` fallback persists and reviews the
      same as a pool-drawn test.
- [ ] `README.md` and `CLAUDE.md` reflect the persistence sub-project.

---

## 12. Glossary and next steps

- **Attempt** — one submitted test: a `sat.test_attempts` row plus its
  `sat.attempt_responses` rows.
- **Snapshot** — storing the question exactly as presented (shuffled choices,
  rewritten answer index) in `attempt_responses`, rather than referencing
  `sat.questions` (Decision D4).
- **Property Ledger Supabase project** — `falgykkspbtrwdcchayi`, shared; SAT
  objects live under the `sat` schema.

**Next steps after this spec is approved:**
1. Spec review loop (spec-document-reviewer subagent).
2. `superpowers:writing-plans` → the implementation plan.
3. `superpowers:subagent-driven-development` → execute, landing the commits on
   `main` and tagging `post-persistence`.
