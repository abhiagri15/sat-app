# SAT-App Persistence — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a submitted test to Supabase, show the signed-in user's test history on `/dashboard`, and let them open any past attempt in a read-only review.

**Architecture:** Two new `sat`-schema tables — `test_attempts` (one row per submitted test) and `attempt_responses` (one row per question, snapshotting the question as it was presented). A `security definer` RPC `save_attempt` is the single, transactional write path. A pure `toAttemptPayload` maps the in-memory test into the persisted shape; a zod-validated `saveAttempt` server action calls the RPC; `useTestSession` fires it once via a guarded effect when a test is submitted. `/dashboard` becomes a history list and `/dashboard/attempts/[id]` a drill-down review reusing the existing `ReviewItem`.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript (strict) · pnpm · `@supabase/ssr` + `@supabase/supabase-js` · zod · Postgres (Supabase).

**Spec:** [2026-05-21-sat-app-persistence-design.md](../specs/2026-05-21-sat-app-persistence-design.md)

**Builds on:** the AI sub-project, tagged `post-ai`. Lands seven commits on `main`, tagged `post-persistence`.

**Verification model:** No automated test runner (spec Decision D8). Each task's gate is `pnpm type-check` (plus `pnpm build` where pages are added) and `pnpm lint`. The pure `toAttemptPayload` is exercised by `scripts/check-payload.ts` (Task 2). The spec §11 checklist runs at Task 7, including MCP SQL checks and a manual click-through.

**Shell:** Windows / PowerShell 5.1. Use the **Bash tool with a `cat <<'EOF'` here-doc** for every git commit message (a PowerShell here-string has repeatedly mangled commit messages in this repo). Run all commands from `C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/satpracticereact/sat-app`.

**No external setup required.** This sub-project adds no environment variables. It uses the existing SSR Supabase client (anon key + cookies); no service-role key, no AI keys.

**Migration application:** The implementer *writes and commits* the migration file. The **controller** applies it to the shared Supabase project (`falgykkspbtrwdcchayi`) via `mcp__claude_ai_Supabase__apply_migration` and verifies it — the same split used for the Foundation/Auth/AI migrations.

---

## Plan-wide File Structure

```
sat-app/
├── README.md / CLAUDE.md                              # MODIFIED (Task 7)
│
├── supabase/migrations/
│   └── 20260521050000_sat_test_attempts.sql           # CREATED (Task 1)
│
├── scripts/
│   └── check-payload.ts                               # CREATED (Task 2)
│
├── app/
│   ├── lib/persistence/
│   │   ├── payload.ts                                 # CREATED (Task 2)
│   │   ├── schema.ts                                  # CREATED (Task 3)
│   │   ├── actions.ts                                 # CREATED (Task 3)
│   │   └── queries.ts                                 # CREATED (Task 5; extended Task 6)
│   │
│   ├── hooks/useTestSession.ts                        # MODIFIED (Task 4: save effect)
│   │
│   ├── components/
│   │   ├── SatPractice.tsx                            # MODIFIED (Task 4: pass saveStatus)
│   │   ├── ResultsScreen.tsx                          # MODIFIED (Task 4: save indicator)
│   │   ├── ReviewItem.tsx                             # MODIFIED (Task 6: stale comment only)
│   │   └── AttemptCard.tsx                            # CREATED (Task 5)
│   │
│   └── (app)/dashboard/
│       ├── page.tsx                                   # MODIFIED (Task 5: placeholder → list)
│       └── attempts/[id]/page.tsx                     # CREATED (Task 6: review page)
│
└── docs/superpowers/plans/2026-05-21-sat-app-persistence-implementation.md   # this file
```

---

## Chunk 1: Data model + payload mapping

Two commits. After Chunk 1 the two tables + the `save_attempt` RPC exist in Supabase, and the pure `toAttemptPayload` mapper is written and verified by a scripted check. Nothing in the running app is wired up yet.

### Task 1: `sat.test_attempts` + `sat.attempt_responses` + `save_attempt` migration

**Files:**
- Create: `supabase/migrations/20260521050000_sat_test_attempts.sql`

- [ ] **Step 1.1: Create the migration file.**

Create `supabase/migrations/20260521050000_sat_test_attempts.sql` with EXACTLY this SQL (it is the spec §6.1 SQL verbatim):

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
-- write path is the save_attempt RPC (security definer -> bypasses RLS).
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
  explanation   text not null,                         -- snapshot — see spec D4
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
  -- Defensive: the server action's zod schema already requires a non-empty
  -- responses array; this keeps the RPC safe regardless of its caller.
  if jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
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
    answer_index, explanation, chosen_index, is_correct
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
    (r ->> 'chosenIndex')::int,        -- JSON null -> SQL NULL
    (r ->> 'isCorrect')::boolean
  from jsonb_array_elements(p_responses) as r;

  return v_id;
end;
$$;

-- Authenticated users read their own rows directly (listAttempts / getAttempt),
-- so an explicit SELECT grant is required for the select policies to function
-- (unlike sat.questions, which authenticated reads only through draw_questions).
-- RLS still scopes every read to the user. No INSERT/UPDATE/DELETE grant — the
-- save_attempt RPC (security definer) is the only writer.
grant select on sat.test_attempts to authenticated;
grant select on sat.attempt_responses to authenticated;
grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;
```

- [ ] **Step 1.2: Commit the migration file.**

```bash
git add supabase/migrations/20260521050000_sat_test_attempts.sql && git commit -F- <<'EOF'
feat(persistence): sat.test_attempts + attempt_responses + save_attempt RPC

Two sat-schema tables for submitted-test history, RLS select-only scoped
to auth.uid(), and a security-definer save_attempt RPC that inserts an
attempt and all its response rows transactionally.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 1.3: Controller applies the migration.**

The **controller** (not a subagent) applies the committed file to the Supabase project `falgykkspbtrwdcchayi` via `mcp__claude_ai_Supabase__apply_migration` (name `sat_test_attempts`, the SQL body from Step 1.1).

- [ ] **Step 1.4: Verify the schema.**

The controller runs, via `mcp__claude_ai_Supabase__execute_sql`:

```sql
select c.relname, c.relrowsecurity as rls_enabled
from pg_class c
where c.relnamespace = 'sat'::regnamespace
  and c.relname in ('test_attempts','attempt_responses');

select tablename, policyname, cmd
from pg_policies
where schemaname = 'sat' and tablename in ('test_attempts','attempt_responses');

select proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'sat' and p.proname = 'save_attempt';
```

Expected: both tables exist with `rls_enabled = true`; exactly one policy per table, both `cmd = SELECT`; `save_attempt` exists.

**Task 1 done when:** the migration is committed, applied, and the three verification queries return the expected rows.

### Task 2: `toAttemptPayload` mapper + its scripted check

**Files:**
- Create: `app/lib/persistence/payload.ts`
- Create: `scripts/check-payload.ts`

- [ ] **Step 2.1: Write the check script first (it will fail to import).**

Create `scripts/check-payload.ts`. It mirrors the existing `scripts/seed-questions.ts` style — relative imports, run with `tsx`. It builds a short test from the in-code `BANK`, answers section 0 fully correct and section 1 first-skipped/rest-wrong, runs `toAttemptPayload`, and asserts the shape.

```ts
// Scripted check for toAttemptPayload — the project has no test runner (spec D8).
// Run: pnpm dlx tsx scripts/check-payload.ts
import { buildTest, computeResults } from '../app/lib/test';
import { toAttemptPayload } from '../app/lib/persistence/payload';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok —', msg);
}

const test = buildTest('Test Student', 'short');

// section 0: every answer correct. section 1: first question skipped, rest wrong.
const responses: (number | null)[][] = test.sections.map((sec, si) =>
  sec.questions.map((q, qi) => {
    if (si === 0) return q.answerIndex;               // correct
    if (qi === 0) return null;                        // skipped
    return (q.answerIndex + 1) % q.choices.length;    // wrong
  }),
);

const results = computeResults(test, responses);
const payload = toAttemptPayload(test, responses, results, 'short');

const totalQ = test.sections.reduce((n, s) => n + s.questions.length, 0);
assert(payload.responses.length === totalQ,
  `responses count (${payload.responses.length}) === question count (${totalQ})`);
assert(payload.totalQuestions === totalQ, `totalQuestions === ${totalQ}`);
assert(payload.studentName === 'Test Student', 'studentName carried from test.name');
assert(payload.testLength === 'short', 'testLength carried through');
assert(payload.scaledScore >= 400 && payload.scaledScore <= 1600,
  `scaledScore ${payload.scaledScore} within 400..1600`);
assert(payload.sectionBreakdown.length === test.sections.length,
  'sectionBreakdown has one entry per section');

const sec0 = payload.responses.filter((r) => r.sectionKey === test.sections[0].key);
assert(sec0.length > 0 && sec0.every((r) => r.isCorrect),
  'every section-0 response isCorrect');

const skipped = payload.responses.find((r) => r.chosenIndex === null);
assert(skipped !== undefined, 'a skipped response exists');
assert(skipped!.isCorrect === false, 'skipped response has isCorrect === false');

const wrong = payload.responses.find((r) => r.chosenIndex !== null && !r.isCorrect);
assert(wrong !== undefined, 'an incorrect response exists');
assert(typeof wrong!.questionId === 'string' && wrong!.questionId.length > 0,
  'questionId is a non-empty string');
assert(wrong!.explanation.length > 0, 'explanation is non-empty');

console.log('\nALL CHECKS PASSED');
```

- [ ] **Step 2.2: Run the check — confirm it fails (module not found).**

Run: `pnpm dlx tsx scripts/check-payload.ts`
Expected: FAIL — an error resolving `../app/lib/persistence/payload` (the file does not exist yet).

- [ ] **Step 2.3: Write `toAttemptPayload`.**

Create `app/lib/persistence/payload.ts`:

```ts
import type { SectionKey } from '@/app/lib/questions';
import type { Test, Results, TestLength } from '@/app/lib/test';

// One persisted question in an attempt — the question AS PRESENTED plus the
// user's answer. `choices`/`answerIndex` are the shuffled values (spec D4).
export interface AttemptResponsePayload {
  sectionKey: SectionKey;
  sectionName: string;
  position: number;            // 0-indexed within the section
  questionId: string;
  skill: string;
  source: 'seed' | 'ai';
  passage: string | null;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  chosenIndex: number | null;  // null = skipped
  isCorrect: boolean;
}

// A whole submitted test, in the shape the save_attempt RPC consumes.
export interface AttemptPayload {
  studentName: string;
  testLength: TestLength;
  totalCorrect: number;
  totalQuestions: number;
  scaledScore: number;
  sectionBreakdown: { name: string; correct: number; total: number }[];
  responses: AttemptResponsePayload[];
}

// Pure: maps a finished in-memory test into the persisted payload. No I/O.
export function toAttemptPayload(
  test: Test,
  responses: (number | null)[][],
  results: Results,
  testLength: TestLength,
): AttemptPayload {
  const attemptResponses: AttemptResponsePayload[] = [];
  for (let si = 0; si < test.sections.length; si++) {
    const section = test.sections[si];
    for (let qi = 0; qi < section.questions.length; qi++) {
      const q = section.questions[qi];
      const chosenIndex = responses[si]?.[qi] ?? null;
      attemptResponses.push({
        sectionKey: section.key,
        sectionName: section.name,
        position: qi,
        questionId: q.id,
        skill: q.skill,
        source: q.source,
        passage: q.passage ?? null,
        prompt: q.prompt,
        choices: q.choices,
        answerIndex: q.answerIndex,
        explanation: q.explanation,
        chosenIndex,
        isCorrect: chosenIndex === q.answerIndex,
      });
    }
  }
  const totalCorrect = results.perSection.reduce((sum, s) => sum + s.correct, 0);
  const totalQuestions = results.perSection.reduce((sum, s) => sum + s.total, 0);
  return {
    studentName: test.name,
    testLength,
    totalCorrect,
    totalQuestions,
    scaledScore: results.scaled,
    sectionBreakdown: results.perSection,
    responses: attemptResponses,
  };
}
```

- [ ] **Step 2.4: Run the check — confirm it passes.**

Run: `pnpm dlx tsx scripts/check-payload.ts`
Expected: each `ok —` line prints, ending with `ALL CHECKS PASSED`.

- [ ] **Step 2.5: Type-check.**

Run: `pnpm type-check`
Expected: exits 0, no errors.

- [ ] **Step 2.6: Commit.**

```bash
git add app/lib/persistence/payload.ts scripts/check-payload.ts && git commit -F- <<'EOF'
feat(persistence): toAttemptPayload mapper + scripted check

Pure function mapping a finished in-memory Test/Results into the
AttemptPayload shape the save_attempt RPC consumes. scripts/check-payload.ts
exercises it (correct / skipped / incorrect cases) since the project has
no test runner.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

**Chunk 1 exit criteria:** the two tables + RPC exist and are verified; `toAttemptPayload` is written and its check passes; `pnpm type-check` is clean. Two commits.

---

## Chunk 2: Save path

Two commits. After Chunk 2 a submitted test is validated, sent through the `save_attempt` RPC, and persisted — fired automatically once when the results screen appears, with a save indicator on the results screen.

### Task 3: zod schema + `saveAttempt` server action

**Files:**
- Create: `app/lib/persistence/schema.ts`
- Create: `app/lib/persistence/actions.ts`

- [ ] **Step 3.1: Write the zod schema.**

Create `app/lib/persistence/schema.ts`. It mirrors `AttemptPayload` field-for-field so the server action rejects a malformed payload before any DB call.

```ts
import { z } from 'zod';

const attemptResponseSchema = z.object({
  sectionKey: z.enum(['rw', 'math']),
  sectionName: z.string().min(1),
  position: z.number().int().min(0),
  questionId: z.string().min(1),
  skill: z.string().min(1),
  source: z.enum(['seed', 'ai']),
  passage: z.string().nullable(),
  prompt: z.string().min(1),
  choices: z.array(z.string()).min(1),
  answerIndex: z.number().int().min(0),
  explanation: z.string().min(1),
  chosenIndex: z.number().int().min(0).nullable(),
  isCorrect: z.boolean(),
});

export const attemptPayloadSchema = z.object({
  studentName: z.string().min(1),
  testLength: z.enum(['short', 'full']),
  totalCorrect: z.number().int().min(0),
  totalQuestions: z.number().int().positive(),
  scaledScore: z.number().int().min(400).max(1600),
  sectionBreakdown: z
    .array(
      z.object({
        name: z.string().min(1),
        correct: z.number().int().min(0),
        total: z.number().int().min(0),
      }),
    )
    .min(1),
  responses: z.array(attemptResponseSchema).min(1),
});
```

- [ ] **Step 3.2: Write the server action.**

Create `app/lib/persistence/actions.ts`:

```ts
'use server';

import { createClient } from '@/app/lib/supabase/server';
import { attemptPayloadSchema } from './schema';
import type { AttemptPayload } from './payload';

export type SaveAttemptResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Persists a finished test. Validates the payload, then calls the
// sat.save_attempt RPC — transactional, and it sets user_id from auth.uid()
// itself, so the client never supplies an identity.
export async function saveAttempt(
  payload: AttemptPayload,
): Promise<SaveAttemptResult> {
  const parsed = attemptPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('[saveAttempt] invalid payload', parsed.error);
    return { ok: false, error: 'invalid payload' };
  }
  const p = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.schema('sat').rpc('save_attempt', {
    p_attempt: {
      studentName: p.studentName,
      testLength: p.testLength,
      totalCorrect: p.totalCorrect,
      totalQuestions: p.totalQuestions,
      scaledScore: p.scaledScore,
      sectionBreakdown: p.sectionBreakdown,
    },
    p_responses: p.responses,
  });
  if (error) {
    console.error('[saveAttempt] rpc error', error);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data as string };
}
```

- [ ] **Step 3.3: Type-check.**

Run: `pnpm type-check`
Expected: exits 0, no errors.

- [ ] **Step 3.4: Lint.**

Run: `pnpm lint`
Expected: no errors (warnings tolerated only if pre-existing).

- [ ] **Step 3.5: Commit.**

```bash
git add app/lib/persistence/schema.ts app/lib/persistence/actions.ts && git commit -F- <<'EOF'
feat(persistence): zod schema + saveAttempt server action

attemptPayloadSchema validates the payload field-for-field; the saveAttempt
server action validates then calls the sat.save_attempt RPC via the SSR
client (authenticated as the user).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 4: fire the save from `useTestSession` + results-screen indicator

**Files:**
- Modify: `app/hooks/useTestSession.ts`
- Modify: `app/components/SatPractice.tsx`
- Modify: `app/components/ResultsScreen.tsx`

- [ ] **Step 4.1: Add the imports and `SaveStatus` type to `useTestSession.ts`.**

At the top of `app/hooks/useTestSession.ts`, after the existing `import { drawTestQuestions } from '@/app/lib/pool';` line, add:

```ts
import { toAttemptPayload } from '@/app/lib/persistence/payload';
import { saveAttempt } from '@/app/lib/persistence/actions';
```

Immediately after the existing `export type Screen = 'start' | 'test' | 'results';` line, add:

```ts
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
```

- [ ] **Step 4.2: Add `saveStatus` to the `TestSession` interface.**

In the `TestSession` interface, in the `// state` group (next to `loading: boolean;`), add:

```ts
  saveStatus: SaveStatus;
```

- [ ] **Step 4.3: Add the `saveStatus` state and the `savedRef` guard.**

After the existing `const [loading, setLoading] = useState(false);` line, add:

```ts
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  // Guards the save effect so a submitted test is persisted exactly once.
  const savedRef = useRef(false);
```

- [ ] **Step 4.4: Add the save effect.**

Immediately after the countdown `useEffect` block (the one that ends with `}, [screen, secIdx]);`), add this effect:

```ts
  // Persist the attempt exactly once, when the results screen first appears.
  // Runs as an effect (not inside finish()) so it reads committed state.
  useEffect(() => {
    if (screen !== 'results' || !test || savedRef.current) return;
    savedRef.current = true;
    const finalResults = computeResults(test, responses);
    setSaveStatus('saving');
    saveAttempt(toAttemptPayload(test, responses, finalResults, testLength))
      .then((res) => {
        setSaveStatus(res.ok ? 'saved' : 'error');
        if (!res.ok) console.error('[useTestSession] saveAttempt failed:', res.error);
      })
      .catch((e) => {
        setSaveStatus('error');
        console.error('[useTestSession] saveAttempt threw:', e);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);
```

- [ ] **Step 4.5: Reset the guard in `newTest()`.**

In the `newTest` function, after the existing `stopTimer();` line and before `setScreen('start');`, add:

```ts
    savedRef.current = false;
    setSaveStatus('idle');
```

- [ ] **Step 4.6: Expose `saveStatus` in the returned object.**

In the `return { ... }` object at the end of the hook, add `saveStatus` to the state group — change the line `showReview, toggleReview, loading,` to:

```ts
    showReview, toggleReview, loading, saveStatus,
```

- [ ] **Step 4.7: Pass `saveStatus` from `SatPractice` to `ResultsScreen`.**

In `app/components/SatPractice.tsx`, in the `<ResultsScreen ... />` element, add the prop `saveStatus={s.saveStatus}` (e.g. right after `results={s.results}`).

- [ ] **Step 4.8: Render the save indicator in `ResultsScreen`.**

In `app/components/ResultsScreen.tsx`:

First, add the type import — after the existing `import type { Test, Results } from '@/app/lib/test';` line, add:

```ts
import type { SaveStatus } from '@/app/hooks/useTestSession';
```

Add `saveStatus` to `ResultsScreenProps` (after `results: Results;`):

```ts
  saveStatus: SaveStatus;
```

Add `saveStatus` to the destructured parameters — change `test, responses, results, showReview, onToggleReview, onNewTest,` to:

```ts
  test, responses, results, saveStatus, showReview, onToggleReview, onNewTest,
```

Then replace the existing closing note paragraph:

```tsx
          <p className="text-sm text-slate-500 mt-3">
            Scaled score is an approximation based on percent correct, for practice motivation only. Focus
            on the explanations below to learn from each question.
          </p>
```

with the save indicator followed by that same note:

```tsx
          {saveStatus === 'saving' && (
            <p className="text-sm text-slate-500 mt-3">Saving to your dashboard…</p>
          )}
          {saveStatus === 'saved' && (
            <p className="text-sm text-emerald-700 mt-3">Saved to your dashboard ✓</p>
          )}
          {saveStatus === 'error' && (
            <p className="text-sm text-red-700 mt-3">
              Couldn’t save this attempt — your history may be incomplete.
            </p>
          )}
          <p className="text-sm text-slate-500 mt-3">
            Scaled score is an approximation based on percent correct, for practice motivation only. Focus
            on the explanations below to learn from each question.
          </p>
```

- [ ] **Step 4.9: Type-check and lint.**

Run: `pnpm type-check`
Expected: exits 0, no errors.
Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4.10: Commit.**

```bash
git add app/hooks/useTestSession.ts app/components/SatPractice.tsx app/components/ResultsScreen.tsx && git commit -F- <<'EOF'
feat(persistence): save a submitted test from useTestSession

A guarded effect fires saveAttempt once when the results screen first
appears, reading committed state. ResultsScreen shows a small, non-blocking
save indicator (saving / saved / error).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

**Chunk 2 exit criteria:** submitting a test calls `saveAttempt` once; the results screen shows the save status; `pnpm type-check` and `pnpm lint` are clean. Two commits.

---

## Chunk 3: Dashboard pages, verification, docs

Three commits plus the tag. After Chunk 3 `/dashboard` lists past attempts and `/dashboard/attempts/[id]` reviews one; the spec §11 checklist passes; `post-persistence` is tagged.

### Task 5: dashboard history list

**Files:**
- Create: `app/lib/persistence/queries.ts`
- Create: `app/components/AttemptCard.tsx`
- Modify: `app/(app)/dashboard/page.tsx`

- [ ] **Step 5.1: Write the read helpers (`listAttempts` + types).**

Create `app/lib/persistence/queries.ts`. (Task 6 extends this same file with `getAttempt` and `responseToQuestion` — create only `listAttempts` and the types now.)

```ts
import { createClient } from '@/app/lib/supabase/server';

export interface SectionBreakdownEntry {
  name: string;
  correct: number;
  total: number;
}

// A test_attempts row, as listed on /dashboard.
export interface AttemptSummary {
  id: string;
  created_at: string;
  student_name: string;
  test_length: 'short' | 'full';
  total_correct: number;
  total_questions: number;
  scaled_score: number;
  section_breakdown: SectionBreakdownEntry[];
}

const SUMMARY_COLUMNS =
  'id, created_at, student_name, test_length, total_correct, total_questions, scaled_score, section_breakdown';

// The signed-in user's attempts, newest first. RLS scopes the rows to them.
// The id tie-break keeps the order stable for attempts saved in the same ms.
export async function listAttempts(): Promise<AttemptSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('test_attempts')
    .select(SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) {
    console.error('[listAttempts] failed:', error);
    return [];
  }
  return (data ?? []) as unknown as AttemptSummary[];
}
```

- [ ] **Step 5.2: Write the `AttemptCard` component.**

Create `app/components/AttemptCard.tsx`. It is a plain (non-client) component — no hooks — so it renders inside the server-component dashboard page.

```tsx
import Link from 'next/link';
import type { AttemptSummary } from '@/app/lib/persistence/queries';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AttemptCard({ attempt }: { attempt: AttemptSummary }) {
  return (
    <Link
      href={`/dashboard/attempts/${attempt.id}`}
      className="block rounded-lg border border-slate-200 p-4 transition hover:border-blue-400 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">{formatDate(attempt.created_at)}</div>
          <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {attempt.test_length === 'full' ? 'Full' : 'Short'} test
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-blue-600">{attempt.scaled_score}</div>
          <div className="text-xs text-slate-500">
            {attempt.total_correct}/{attempt.total_questions} correct
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {attempt.section_breakdown.map((s) => (
          <span
            key={s.name}
            className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600"
          >
            {s.name}: {s.correct}/{s.total}
          </span>
        ))}
      </div>
    </Link>
  );
}
```

- [ ] **Step 5.3: Replace the dashboard placeholder with the history list.**

Replace the entire contents of `app/(app)/dashboard/page.tsx` with:

```tsx
import Link from 'next/link';
import { getOrCreateProfile } from '@/app/lib/auth/profile';
import { listAttempts } from '@/app/lib/persistence/queries';
import { AttemptCard } from '@/app/components/AttemptCard';

export default async function DashboardPage() {
  const profile = await getOrCreateProfile();
  const attempts = await listAttempts();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-2xl font-bold">Your dashboard</h1>
      <p className="text-slate-600">
        Signed in as {profile?.full_name || profile?.email}.
      </p>

      {attempts.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-slate-600">You haven’t taken a test yet.</p>
          <Link href="/" className="mt-3 inline-block text-blue-600 underline">
            Take your first test
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <h2 className="text-sm font-semibold text-slate-500">Your test history</h2>
          {attempts.map((a) => (
            <AttemptCard key={a.id} attempt={a} />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 5.4: Type-check, lint, build.**

Run: `pnpm type-check` → exits 0.
Run: `pnpm lint` → no new errors.
Run: `pnpm build` → completes; `/dashboard` builds without error.

- [ ] **Step 5.5: Commit.**

```bash
git add app/lib/persistence/queries.ts app/components/AttemptCard.tsx "app/(app)/dashboard/page.tsx" && git commit -F- <<'EOF'
feat(persistence): dashboard test-history list

listAttempts reads the user's attempts (RLS-scoped, newest first).
/dashboard replaces its placeholder with a list of AttemptCards, each
linking to the attempt review, with an empty state for new users.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 6: attempt review page

**Files:**
- Modify: `app/lib/persistence/queries.ts` (add `getAttempt`, `responseToQuestion`, types)
- Create: `app/(app)/dashboard/attempts/[id]/page.tsx`
- Modify: `app/components/ReviewItem.tsx` (stale header comment only)

- [ ] **Step 6.1: Extend `queries.ts` with `getAttempt` and `responseToQuestion`.**

In `app/lib/persistence/queries.ts`, add the `Question` type import at the top — change the first import line to:

```ts
import { createClient } from '@/app/lib/supabase/server';
import type { Question } from '@/app/lib/questions';
```

Then append to the end of the file:

```ts
// One attempt_responses row, as stored.
export interface AttemptResponseRow {
  id: string;
  section_key: 'rw' | 'math';
  section_name: string;
  position: number;
  question_id: string;
  skill: string;
  source: 'seed' | 'ai';
  passage: string | null;
  prompt: string;
  choices: unknown;          // jsonb — guarded to string[] in responseToQuestion
  answer_index: number;
  explanation: string;
  chosen_index: number | null;
  is_correct: boolean;
}

export interface AttemptDetail {
  attempt: AttemptSummary;
  responses: AttemptResponseRow[];
}

const RESPONSE_COLUMNS =
  'id, section_key, section_name, position, question_id, skill, source, passage, prompt, choices, answer_index, explanation, chosen_index, is_correct';

// One attempt with all its responses, or null if it does not exist / is not
// the caller's (RLS) / the id is not a valid uuid (a malformed id makes the
// first query error — caught and treated as not-found).
export async function getAttempt(id: string): Promise<AttemptDetail | null> {
  const supabase = await createClient();

  const { data: attempt, error: attemptError } = await supabase
    .schema('sat')
    .from('test_attempts')
    .select(SUMMARY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (attemptError || !attempt) return null;

  const { data: responses, error: responsesError } = await supabase
    .schema('sat')
    .from('attempt_responses')
    .select(RESPONSE_COLUMNS)
    .eq('attempt_id', id)
    .order('position', { ascending: true });
  if (responsesError) return null;

  return {
    attempt: attempt as unknown as AttemptSummary,
    responses: (responses ?? []) as unknown as AttemptResponseRow[],
  };
}

// Reconstructs the Question shape ReviewItem expects from a stored response.
export function responseToQuestion(row: AttemptResponseRow): Question {
  return {
    id: row.question_id,
    section: row.section_key,
    skill: row.skill,
    passage: row.passage ?? undefined,
    prompt: row.prompt,
    // `choices` is jsonb — guard a malformed value, matching rowToQuestion.
    choices: Array.isArray(row.choices) ? (row.choices as string[]) : [],
    answerIndex: row.answer_index,
    explanation: row.explanation,
    source: row.source,
  };
}
```

- [ ] **Step 6.2: Create the review page.**

Create `app/(app)/dashboard/attempts/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAttempt, responseToQuestion } from '@/app/lib/persistence/queries';
import { ReviewItem } from '@/app/components/ReviewItem';
import { SECTION_ORDER, SECTION_CONFIG } from '@/app/lib/questions';

export default async function AttemptReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAttempt(id);
  if (!detail) notFound();

  const { attempt, responses } = detail;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/dashboard" className="text-sm text-blue-600 underline">
        ← Back to dashboard
      </Link>

      <h1 className="mt-3 text-2xl font-bold">Attempt review</h1>
      <div className="mt-1 text-sm text-slate-500">
        {new Date(attempt.created_at).toLocaleString()} ·{' '}
        {attempt.test_length === 'full' ? 'Full' : 'Short'} test
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-4">
        <div className="text-4xl font-extrabold text-blue-600">
          {attempt.scaled_score}
        </div>
        <div className="text-slate-600">
          {attempt.total_correct}/{attempt.total_questions} correct
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {attempt.section_breakdown.map((s) => (
          <span
            key={s.name}
            className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600"
          >
            {s.name}: {s.correct}/{s.total}
          </span>
        ))}
      </div>

      {SECTION_ORDER.map((sectionKey) => {
        const rows = responses
          .filter((r) => r.section_key === sectionKey)
          .sort((a, b) => a.position - b.position);
        if (rows.length === 0) return null;
        return (
          <section key={sectionKey} className="mt-8">
            <h2 className="mb-3 text-base font-semibold">
              {SECTION_CONFIG[sectionKey].name} — review
            </h2>
            {rows.map((row) => (
              <ReviewItem
                key={row.id}
                question={responseToQuestion(row)}
                chosenIndex={row.chosen_index}
              />
            ))}
          </section>
        );
      })}
    </main>
  );
}
```

- [ ] **Step 6.3: Correct the stale comment in `ReviewItem.tsx`.**

In `app/components/ReviewItem.tsx`, replace the stale 3-line header comment:

```tsx
// NOTE: explanation rendering uses dangerouslySetInnerHTML because seed BANK content
// contains trusted <b>/<i> tags. The AI sub-project (#2) MUST replace this with a
// sanitizer or constrained renderer once questions become user-influenced.
```

with:

```tsx
// NOTE: explanation rendering branches on `question.source`. Seed BANK content
// has trusted <b>/<i> tags and is rendered via dangerouslySetInnerHTML; AI
// content is rendered as React-escaped text (no HTML). This guard shipped with
// the AI sub-project (#2) and is relied on by the attempt-review page (#4),
// which renders snapshotted explanations through this component.
```

This is a comment-only change — no behavior change.

- [ ] **Step 6.4: Type-check, lint, build.**

Run: `pnpm type-check` → exits 0.
Run: `pnpm lint` → no new errors.
Run: `pnpm build` → completes; `/dashboard/attempts/[id]` builds as a dynamic route.

- [ ] **Step 6.5: Commit.**

```bash
git add app/lib/persistence/queries.ts "app/(app)/dashboard/attempts/[id]/page.tsx" app/components/ReviewItem.tsx && git commit -F- <<'EOF'
feat(persistence): per-attempt review page

getAttempt fetches one attempt + its responses (two queries; not-found
decided by the attempt query). /dashboard/attempts/[id] renders the review
grouped by section through the existing ReviewItem; a missing or foreign
attempt 404s. Also corrects ReviewItem's stale #2-era header comment.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 7: verification, docs, tag

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 7.1: Full static gate.**

Run, and confirm all pass:
- `pnpm type-check` → exits 0.
- `pnpm lint` → no errors.
- `pnpm build` → completes.

- [ ] **Step 7.2: Controller verifies the schema posture (MCP SQL).**

The controller runs via `mcp__claude_ai_Supabase__execute_sql`:

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'sat' and tablename in ('test_attempts','attempt_responses');
```

Expected: exactly one policy per table, both `cmd = SELECT`, none for INSERT/UPDATE/DELETE.

- [ ] **Step 7.3: Manual runtime click-through.**

Start `pnpm dev`. Signed in as a test user:
1. Take and submit a **Quick** test. Confirm `ResultsScreen` shows "Saved to your dashboard ✓".
2. Open `/dashboard` — the attempt appears, newest first, with score and section chips.
3. Click the attempt — `/dashboard/attempts/[id]` shows every question marked correct / incorrect / skipped, the correct answer, and the explanation, matching the post-submit review.
4. Visit `/dashboard/attempts/00000000-0000-0000-0000-000000000000` and `/dashboard/attempts/not-a-uuid` — both render the 404 page, no crash.

- [ ] **Step 7.4: Controller verifies persisted rows + cross-user isolation (MCP SQL).**

The controller runs via `mcp__claude_ai_Supabase__execute_sql`:

```sql
select ta.id, ta.total_questions,
       count(ar.id) as response_rows
from sat.test_attempts ta
left join sat.attempt_responses ar on ar.attempt_id = ta.id
group by ta.id, ta.total_questions
order by ta.created_at desc
limit 5;
```

Expected: for the just-submitted attempt, `response_rows = total_questions`.

Cross-user isolation: the spec §11 requires that user B cannot read user A's attempt. Confirm the RLS `select` policy is `(select auth.uid()) = user_id` (verified in Step 7.2) and that Step 7.3 item 4's foreign-id case 404s — together these establish isolation. If a second test account is available, sign in as user B and confirm user A's attempt id 404s.

- [ ] **Step 7.5: Update `README.md` and `CLAUDE.md`.**

`README.md`: add a "Test history (persistence)" section — submitting a test saves it to `sat.test_attempts` / `sat.attempt_responses`; `/dashboard` lists history; `/dashboard/attempts/[id]` reviews one attempt.

`CLAUDE.md`: note the persistence sub-project shipped, and the gotchas — the two attempt tables are RLS select-only (the `save_attempt` security-definer RPC is the only writer); responses snapshot the question as presented because `buildTest` shuffles choices per test; `toAttemptPayload` is verified by `scripts/check-payload.ts` (no test runner).

- [ ] **Step 7.6: Commit the docs.**

```bash
git add README.md CLAUDE.md && git commit -F- <<'EOF'
docs(persistence): sync README and CLAUDE.md for the persistence sub-project

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7.7: Tag.**

```bash
git tag post-persistence && git tag --list && git diff post-ai..post-persistence --stat | tail -3
```

**Chunk 3 exit criteria:** `/dashboard` lists attempts and `/dashboard/attempts/[id]` reviews one; the spec §11 checklist passes; docs synced; `post-persistence` tagged. Three commits.

---

## Plan Complete

Seven commits land on `main` after the spec commits:
1. `sat.test_attempts` + `sat.attempt_responses` + `save_attempt` RPC (Task 1)
2. `toAttemptPayload` mapper + scripted check (Task 2)
3. zod schema + `saveAttempt` server action (Task 3)
4. Save a submitted test from `useTestSession` (Task 4)
5. Dashboard test-history list (Task 5)
6. Per-attempt review page (Task 6)
7. README/CLAUDE.md sync (Task 7)

Plus the `post-persistence` tag.
