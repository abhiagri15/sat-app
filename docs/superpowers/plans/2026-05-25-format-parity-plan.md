# Question-Format Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SPR (Student-Produced Response) question type, embedded Desmos scientific calculator, and Math reference sheet — closing the question-format gap with the real Digital SAT.

**Architecture:** Schema-led. Three NULL-safe migrations expand `sat.questions` and `sat.attempt_responses` and add a Postgres-side SPR comparison helper. JS-side mirror parser ([app/lib/spr.ts](../../app/lib/spr.ts)) used by the runner and generator. UI branches on `response_format`; two new Math-only side panels for calculator + reference sheet. Generator at ~25% SPR per Math question via a coin-flip; R&W stays mcq-only.

**Tech Stack:** TypeScript / Next.js 15 / React 19 / Supabase (Postgres with RLS + security-definer RPCs) / n8n workflow / Desmos iframe.

**Spec:** [2026-05-25-format-parity-design.md](../specs/2026-05-25-format-parity-design.md)

---

## File Structure

| File | Action |
|---|---|
| `supabase/migrations/20260525010000_sat_questions_format.sql` | NEW — schema additions on `sat.questions` |
| `supabase/migrations/20260525020000_sat_attempt_responses_format.sql` | NEW — schema additions on `sat.attempt_responses` |
| `supabase/migrations/20260525030000_sat_spr_helpers.sql` | NEW — `sat.spr_to_numeric`, `sat.spr_is_correct`, updated `sat.save_attempt` |
| [app/lib/spr.ts](../../app/lib/spr.ts) | NEW — JS parser + comparator |
| `scripts/check-spr.ts` | NEW — scripted parser assertions |
| [app/lib/questions.ts](../../app/lib/questions.ts) | Modify — `Question` type fields, `rowToQuestion` |
| [app/lib/test.ts](../../app/lib/test.ts) | Modify — response types, `shuffleChoices` no-op for spr, `computeResults` branches |
| [app/hooks/useTestSession.ts](../../app/hooks/useTestSession.ts) | Modify — `selectChoice` → `setAnswer` (string \| number) |
| [app/lib/ai/schema.ts](../../app/lib/ai/schema.ts) | Modify — discriminated union mcq \| spr |
| [app/lib/ai/ollama.ts](../../app/lib/ai/ollama.ts) | Modify — SPR generate/solve prompt branches |
| [app/lib/ai/generate.ts](../../app/lib/ai/generate.ts) | Modify — insert path branches on `responseFormat` |
| [app/lib/persistence/payload.ts](../../app/lib/persistence/payload.ts) | Modify — payload carries response_format + entered_value |
| [app/lib/persistence/queries.ts](../../app/lib/persistence/queries.ts) | Modify — `AttemptResponseRow` extended, `responseToQuestion` handles spr |
| `app/components/test/SprInput.tsx` | NEW — SPR text input with format hint |
| `app/components/test/CalculatorPanel.tsx` | NEW — Desmos iframe panel |
| `app/components/test/ReferencePanel.tsx` | NEW — static formula sheet |
| `app/components/SatPractice.tsx` (and the question renderer it composes) | Modify — branch on response_format; tools panels (Math only) |
| n8n workflow Plan Batches + Parse Candidates | Modify — SPR coin-flip + prompt branch + parser branch |
| [CLAUDE.md](../../CLAUDE.md) | Modify — document SPR + tools |
| [README.md](../../README.md) | Modify — brief mention |

---

## Task 1: SQL migrations

**Files:**
- Create: `supabase/migrations/20260525010000_sat_questions_format.sql`
- Create: `supabase/migrations/20260525020000_sat_attempt_responses_format.sql`
- Create: `supabase/migrations/20260525030000_sat_spr_helpers.sql`

- [ ] **Step 1: Write migration 1 — `sat.questions` format columns**

  Add `response_format text` (default 'mcq', check in ('mcq','spr')), `correct_answer text` (nullable), `answer_tolerance numeric` (nullable). Add the soft constraint requiring spr rows to have `correct_answer`.

- [ ] **Step 2: Write migration 2 — `sat.attempt_responses` format columns**

  Add `response_format text` (default 'mcq', check in ('mcq','spr')), `entered_value text` (nullable). Default backfills existing rows to 'mcq' with null entered_value, no explicit backfill needed.

- [ ] **Step 3: Write migration 3 — SPR helpers + save_attempt update**

  Functions:
  - `sat.spr_to_numeric(text) returns numeric` — parses integer / decimal / fraction strings; returns null on failure (immutable, no `sat.` table reads, safe with empty `search_path`).
  - `sat.spr_is_correct(entered text, canonical text, tolerance numeric) returns boolean` — exact-string match first, then numeric tolerance compare (immutable).
  - Recreate `sat.save_attempt(p_attempt jsonb, p_responses jsonb) returns uuid` — same insert behaviour, but each `attempt_responses` row's `is_correct`, `response_format`, `chosen_index`, and `entered_value` are computed/passed through from the payload. For SPR rows, `is_correct` calls `sat.spr_is_correct(entered_value, correct_answer_from_join, tolerance_from_join)`.

  Note: `sat.save_attempt` needs to LOOK UP the canonical `correct_answer` and `answer_tolerance` from `sat.questions` by `question_id` at save time — the client doesn't carry these values (and shouldn't, to prevent tampering). Join via `question_id`.

- [ ] **Step 4: Apply all three via Supabase MCP `apply_migration`**

  Each is independent and re-runnable thanks to `create or replace` / `add column if not exists`.

- [ ] **Step 5: Verify**

  ```sql
  -- Schema:
  \d sat.questions          -- new columns appear
  \d sat.attempt_responses  -- new columns appear

  -- Helper sanity:
  select sat.spr_to_numeric('7'), sat.spr_to_numeric('-0.5'), sat.spr_to_numeric('3/4'), sat.spr_to_numeric('1 1/2');
  -- → 7, -0.5, 0.75, null

  select sat.spr_is_correct('0.5', '1/2', null),
         sat.spr_is_correct('3.14', '3.1415', 0.01),
         sat.spr_is_correct('3.14', '3.1415', null);
  -- → true, true, false

  -- Existing rows unchanged:
  select response_format, count(*) from sat.questions group by 1;
  -- → mcq: <total>
  ```

---

## Task 2: SPR parser (JS side) + scripted assertions

**Files:**
- Create: [app/lib/spr.ts](../../app/lib/spr.ts)
- Create: `scripts/check-spr.ts`

- [ ] **Step 1: Write `app/lib/spr.ts`**

  Export `ParsedSpr` type, `parseSpr(input)`, `isSprCorrect(entered, canonical, tolerance)`. Mirror the Postgres helper's acceptance rules exactly (integer / decimal / fraction; no mixed numbers; no scientific notation). `isSprCorrect` does exact-string match first, then parses both sides and compares with tolerance (default 0).

- [ ] **Step 2: Write `scripts/check-spr.ts`**

  ~30 assertion lines covering: integer parse, negative integer, decimal, leading-dot decimal, negative decimal, simple fraction, negative fraction, mixed-number reject, empty reject, garbage reject, equality with exact match, equality across forms (0.5 == 1/2), inequality, tolerance accept, tolerance reject. Format like `scripts/check-payload.ts` / `scripts/check-analytics.ts`.

- [ ] **Step 3: Run the script**

  `pnpm dlx tsx scripts/check-spr.ts` — exits 0 on success.

---

## Task 3: Type + persistence updates

**Files:**
- Modify: [app/lib/questions.ts](../../app/lib/questions.ts) — extend `Question` type
- Modify: [app/lib/test.ts](../../app/lib/test.ts) — `Test` / `TestSection` types, `shuffleChoices`, `computeResults`
- Modify: [app/lib/persistence/payload.ts](../../app/lib/persistence/payload.ts) — payload mapper
- Modify: [app/lib/persistence/queries.ts](../../app/lib/persistence/queries.ts) — `AttemptResponseRow` + `responseToQuestion`

- [ ] **Step 1: Extend `Question` type with response-format fields**

  ```ts
  export interface Question {
    // ... existing
    response_format: 'mcq' | 'spr';
    correct_answer: string | null;   // SPR canonical answer
    answer_tolerance: number | null; // SPR float tolerance
  }
  ```

  Update `rowToQuestion` to map the new columns from the database row.

  Update `BANK` entries to include `response_format: 'mcq'` (and `correct_answer: null`, `answer_tolerance: null`) — keeps the type happy. Bulk find-replace.

- [ ] **Step 2: Update `Test` / `TestSection` / response types**

  `responses` matrix changes from `(number | null)[][]` to `(number | string | null)[][]`. A number means an mcq choice index, a string means an spr entry, null means unanswered. Update everywhere that touches `responses` accordingly.

  `shuffleChoices` becomes a no-op for spr questions (returns the question unchanged). `buildTest` continues to work; the shuffle just doesn't reorder anything for spr.

  `computeResults` branches:
  ```ts
  if (q.response_format === 'mcq') {
    if (responses[si][qi] === q.answerIndex) correct++;
  } else {
    const v = responses[si][qi];
    if (typeof v === 'string' && q.correct_answer && isSprCorrect(v, q.correct_answer, q.answer_tolerance)) correct++;
  }
  ```

- [ ] **Step 3: Update `payload.ts`**

  Per-response payload becomes:
  ```ts
  {
    sectionKey, sectionName, position, questionId, skill, source,
    passage, prompt, choices, answerIndex, explanation,
    chosenIndex,          // mcq only (null otherwise)
    enteredValue,         // spr only (null otherwise)
    responseFormat,       // 'mcq' | 'spr'
    isCorrect,
  }
  ```

  The script `scripts/check-payload.ts` needs updating to match.

- [ ] **Step 4: Update `persistence/queries.ts`**

  `AttemptResponseRow` gains `response_format`, `entered_value`. `responseToQuestion` returns a Question with `response_format: row.response_format`, `correct_answer: row.correct_answer ?? null` (need to add to RESPONSE_COLUMNS), `answer_tolerance: row.answer_tolerance ?? null`.

  Wait — `attempt_responses` doesn't snapshot `correct_answer` today. It snapshots `answer_index`, `choices`, etc. For mcq-only that's fine because `answer_index` is the truth. For spr, we'd need to also snapshot `correct_answer` and `answer_tolerance` so the review page can reconstruct the canonical answer.

  Add `correct_answer text` and `answer_tolerance numeric` columns to `sat.attempt_responses` in migration 2 (revise the earlier task). The `save_attempt` RPC writes the snapshot from the questions table by JOIN at save time.

- [ ] **Step 5: Type-check**

  `pnpm type-check` — expect a flurry of errors which the changes above should resolve. Iterate until clean.

---

## Task 4: Test runner UI changes

**Files:**
- Create: `app/components/test/SprInput.tsx`
- Create: `app/components/test/CalculatorPanel.tsx`
- Create: `app/components/test/ReferencePanel.tsx`
- Modify: [app/hooks/useTestSession.ts](../../app/hooks/useTestSession.ts) — `setAnswer` accepts string | number
- Modify: [app/components/SatPractice.tsx](../../app/components/SatPractice.tsx) (and any child it composes for the question form / radio list — refactor as needed)

- [ ] **Step 1: Write `SprInput.tsx`**

  ```tsx
  'use client';
  interface Props {
    value: string;
    onChange: (next: string) => void;
  }
  export function SprInput({ value, onChange }: Props) {
    return (
      <div>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9./\-]*"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Numeric answer"
          className="rounded border border-slate-300 px-3 py-2 text-lg w-full max-w-xs"
        />
        <p className="mt-1 text-xs text-slate-500">
          Enter a number or fraction (e.g. 3, 3.14, or 3/4). No mixed numbers.
        </p>
      </div>
    );
  }
  ```

- [ ] **Step 2: Write `CalculatorPanel.tsx`**

  Fixed-position overlay, ~420px wide, with an X button to close.

  ```tsx
  export function CalculatorPanel({ onClose }: { onClose: () => void }) {
    return (
      <aside className="fixed right-4 top-20 z-40 w-[420px] rounded-lg border border-slate-200 bg-white shadow-lg">
        <header className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-medium">Calculator</h2>
          <button onClick={onClose} aria-label="Close calculator" className="text-slate-500 hover:text-slate-900">×</button>
        </header>
        <iframe
          src="https://www.desmos.com/scientific?embed"
          loading="lazy"
          title="Desmos Scientific Calculator"
          className="block h-[500px] w-full"
        />
      </aside>
    );
  }
  ```

- [ ] **Step 3: Write `ReferencePanel.tsx`**

  Same shell as CalculatorPanel, with static formula sheet HTML inside instead of an iframe. Use definition list or grid for readability. Content per spec.

- [ ] **Step 4: Refactor the question renderer in `SatPractice.tsx`**

  Find the part that renders the choices (likely a `<div>` with `.map(choice =>` over radio buttons). Branch:

  ```tsx
  {q.response_format === 'mcq'
    ? <ChoicesRadios ... />
    : <SprInput value={typeof current === 'string' ? current : ''} onChange={(v) => setAnswer(v)} />
  }
  ```

  Where `ChoicesRadios` is the existing list extracted to its own component (or inline if simpler). `current` is `responses[secIdx][qIdx]`.

- [ ] **Step 5: Add Calculator + Reference buttons to the test page header (Math only)**

  In `SatPractice.tsx` test screen, add a row above the question with two buttons that toggle local state:

  ```tsx
  const [calcOpen, setCalcOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const isMath = test.sections[secIdx].key === 'math';
  // ...
  {isMath && (
    <div className="mb-3 flex gap-2">
      <button onClick={() => setCalcOpen(v => !v)} className="rounded border px-2 py-1 text-sm">Calculator</button>
      <button onClick={() => setRefOpen(v => !v)} className="rounded border px-2 py-1 text-sm">Reference</button>
    </div>
  )}
  {calcOpen && isMath && <CalculatorPanel onClose={() => setCalcOpen(false)} />}
  {refOpen && isMath && <ReferencePanel onClose={() => setRefOpen(false)} />}
  ```

- [ ] **Step 6: Update `useTestSession.ts`**

  Rename `selectChoice(i: number)` to `setAnswer(v: string | number)`. Update the state writer accordingly. Existing call sites in radio-button onClick handlers pass a number; SprInput's onChange passes a string. The matrix accepts both via the broader type from Task 3.

- [ ] **Step 7: Type-check + smoke test in dev**

  ```bash
  pnpm type-check
  pnpm dev   # → http://localhost:3000, sign in, take a Math test, verify radios render for mcq questions and the SPR input renders for any spr questions (there are none until Task 5 lands generation)
  ```

  Verify Calculator and Reference buttons appear ONLY on Math section, panels open/close cleanly, Desmos iframe loads.

---

## Task 5: Generator updates (app-side)

**Files:**
- Modify: [app/lib/ai/schema.ts](../../app/lib/ai/schema.ts) — discriminated union
- Modify: [app/lib/ai/ollama.ts](../../app/lib/ai/ollama.ts) — SPR prompt + solve branches, coin-flip
- Modify: [app/lib/ai/generate.ts](../../app/lib/ai/generate.ts) — insert path branches on responseFormat

- [ ] **Step 1: Update `generatedQuestionSchema` to a discriminated union**

  As shown in the spec — mcq variant (existing) and spr variant (section locked to 'math', has `correctAnswer` + optional `answerTolerance`, no `choices` / `answerIndex`).

- [ ] **Step 2: Update `ollama.ts` — `generateQuestions(section, skill, count)`**

  Add a `useSpr` decision at the top: `const useSpr = section === 'math' && Math.random() < 0.25;`. When `useSpr` is true, build a different prompt that asks for SPR-format questions (no choices, with a `correctAnswer` field, optional `answerTolerance` for decimal answers requiring rounding).

  Update the example in the prompt for the SPR branch.

- [ ] **Step 3: Update `ollama.ts` — `solve(q)` branch on SPR**

  When solving an SPR question, ask the model to respond with the numeric answer string (not a 0-3 index). Parse the response by trying `parseSpr` on the trimmed content; return the parsed string. The caller (`generate.ts`) compares with `isSprCorrect`.

- [ ] **Step 4: Update `generate.ts` insert path**

  After self-verify, branch on `q.responseFormat`. For mcq, insert with the existing fields. For spr, insert with `response_format: 'spr'`, `correct_answer: q.correctAnswer`, `answer_tolerance: q.answerTolerance ?? null`, placeholder `choices: []` and `answer_index: 0` (DB columns are still NOT NULL but the SPR row doesn't reference them at test time).

  Also need to update the self-verify compare: instead of `if (solved !== q.answerIndex)`, branch on responseFormat.

- [ ] **Step 5: Type-check + trigger a local generation**

  ```bash
  pnpm type-check
  curl -s -H "Authorization: Bearer <CRON_SECRET>" \
    http://localhost:3000/api/admin/generate-questions
  ```

  Expected: summary returns ≥ 1 accepted; SQL query shows at least one `response_format = 'spr'` row in `sat.questions`. Take a Math test to confirm the SPR input renders for it.

---

## Task 6: n8n workflow updates

**Files:**
- Modify: n8n workflow `jDjJIthvf6EyKwgR`, Plan Batches `jsCode` and Parse Candidates `jsCode`

- [ ] **Step 1: Update Plan Batches `buildPrompt` + emit**

  At the top of `buildPrompt(section, skill)`, decide `const useSpr = section === 'math' && Math.random() < 0.25;`. Build a different prompt for spr (mirrors `ollama.ts` exactly). Output item carries `responseFormat: useSpr ? 'spr' : 'mcq'` (new field) so downstream nodes know which schema to validate.

- [ ] **Step 2: Update Parse Candidates schema validation**

  Branch on `plan.responseFormat`. For mcq, validate the existing fields. For spr, validate `correctAnswer` is a non-empty string, `answerTolerance` is undefined or non-negative number, no `choices` or `answerIndex`. Same skill/section pin.

  Build the solve body differently for spr — the solve prompt asks for a numeric answer, not an index.

- [ ] **Step 3: Update Check Answer + Insert Question for SPR**

  Check Answer: branch on responseFormat. For spr, parse the solver's response with the same JS parser logic (inline since n8n Code nodes can't import). Compare with `isSprCorrect`-equivalent logic.

  Insert Question: insert body for spr includes `response_format: 'spr'`, `correct_answer`, `answer_tolerance`, placeholder `choices: []`, `answer_index: 0`.

- [ ] **Step 4: Validate workflow code via `validate_workflow`**

- [ ] **Step 5: `update_workflow` against `jDjJIthvf6EyKwgR`**

- [ ] **Step 6: User re-pastes secrets**

  Standard `update_workflow` reset; remind user.

---

## Task 7: Docs

**Files:**
- Modify: [CLAUDE.md](../../CLAUDE.md)
- Modify: [README.md](../../README.md)

- [ ] **Step 1: Update `Question` description in CLAUDE.md architecture**

  Note the new `response_format` discriminator.

- [ ] **Step 2: Add SPR + tools gotchas to CLAUDE.md**

  Bullets:
  - SPR rows have `choices = []` and `answer_index = 0` as placeholders — never trust these for spr questions; branch on `response_format` everywhere.
  - The `entered_value` column on `attempt_responses` is the SPR equivalent of `chosen_index`. The two are mutually exclusive per row.
  - SPR comparison happens in TWO places — `app/lib/spr.ts#isSprCorrect` (client + analytics) and `sat.spr_is_correct` (server / save_attempt). Keep them in sync; both have a scripted check (`scripts/check-spr.ts` + SQL sanity queries in the migration).
  - Calculator and Reference panels render only when `test.sections[secIdx].key === 'math'` — never on R&W.

- [ ] **Step 3: Update README.md test-runner section**

  One paragraph: tests now mix mcq and spr questions; Math sections offer a Desmos calculator and a formula reference sheet; R&W stays mcq-only.

---

## Task 8: Commit + push + verify

- [ ] **Step 1: `pnpm type-check`** — expect PASS.

- [ ] **Step 2: `pnpm dlx tsx scripts/check-payload.ts`** — payload mapper assertion still passes after the new fields are added.

- [ ] **Step 3: `pnpm dlx tsx scripts/check-spr.ts`** — SPR parser assertion passes.

- [ ] **Step 4: Stage and commit in logical chunks**

  Two or three commits in this sub-project for cleaner history:

  - Commit A: `feat(spr): schema + parser + helpers` — three migrations, `app/lib/spr.ts`, `scripts/check-spr.ts`.
  - Commit B: `feat(spr): test runner UI + types` — `Question`/`Test` types, persistence updates, `SprInput`, runner branching, panels.
  - Commit C: `feat(ai): generator emits SPR for ~25% of Math questions` — schema + ollama + generate + n8n update + docs.

- [ ] **Step 5: `git push origin main`**

- [ ] **Step 6: Verify end-to-end**

  - SQL: `select response_format, count(*) from sat.questions group by 1;` — `'mcq'` is large, `'spr'` grows from 0.
  - Live app: take a Math test. At least 25% of new questions should be SPR (visible by the input field). Calculator and Reference buttons visible; both panels open and close.
  - Submit a test with one wrong SPR and one correct SPR. Verify `attempt_responses` rows have `entered_value` set and `is_correct` true/false correctly.
  - Review page: SPR responses display "Your answer: X" instead of a letter; correct/incorrect highlighting matches.

- [ ] **Step 7: User re-pastes n8n secrets** — final reminder.

---

## Done criteria

- All migrations applied; new columns present in both tables; helpers callable from SQL.
- `pnpm type-check`, `check-spr`, `check-payload` all green.
- Production has at least one SPR question by t+1h after deploy; ratio approaches 25% over ~24h as generator runs.
- A Math test displays radios for mcq questions and the SprInput for spr questions; calculator + reference panels work on Math sections only.
- Saved attempts persist `entered_value` and `is_correct` correctly for both formats; review page renders both.

After all green, sub-project #9 is shipped. Move on to brainstorming #10 (Score Validity).
