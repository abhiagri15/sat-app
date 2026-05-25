# Question-Format Parity — Design Spec (Sub-project #9)

**Status:** Draft → User review

**Part of:** The "near-real-world SAT" upgrade roadmap (sub-projects #8–#11).

## Goal

Close the question-format gap with the real Digital SAT by adding three independent capabilities:

1. **Student-Produced Response (SPR)** questions — numeric/fraction entry instead of multiple choice. Real SAT Math has ~25% SPR.
2. **Embedded calculator** on Math test pages — Desmos scientific calculator iframe.
3. **Math reference sheet** on Math test pages — the standard College Board formula sheet.

After this sub-project ships, the test runner supports both question formats, students can use a calculator and reference sheet during Math sections, and the generator produces a realistic mix of mcq + spr questions.

## Background

Today every `sat.questions` row is multiple-choice (4 string `choices`, `answer_index` 0–3). The runner — [app/components/SatPractice.tsx](../../app/components/SatPractice.tsx), [app/hooks/useTestSession.ts](../../app/hooks/useTestSession.ts) — has exactly one input mode: radio buttons over the choices. No calculator. No formula sheet. Real Digital SAT bundles both as in-test tools.

## Database changes

### Migration `20260525010000_sat_questions_format.sql`

Add three columns to `sat.questions`:

```sql
alter table sat.questions
  add column if not exists response_format text
    not null default 'mcq'
    check (response_format in ('mcq', 'spr'));

alter table sat.questions
  add column if not exists correct_answer text;  -- SPR canonical answer

alter table sat.questions
  add column if not exists answer_tolerance numeric;  -- SPR float tolerance (NULL = exact)

-- Soft constraint: SPR rows must have a correct_answer.
alter table sat.questions
  add constraint questions_spr_has_answer
  check (
    response_format = 'mcq'
    or (response_format = 'spr' and correct_answer is not null)
  );
```

All existing rows default to `response_format = 'mcq'` and keep working unchanged. The `choices` and `answer_index` columns stay required and meaningful for mcq; for spr rows they should be `[]` and `0` (placeholder values; the runner ignores them when `response_format = 'spr'`).

### Migration `20260525020000_sat_attempt_responses_format.sql`

```sql
alter table sat.attempt_responses
  add column if not exists response_format text
    not null default 'mcq'
    check (response_format in ('mcq', 'spr'));

alter table sat.attempt_responses
  add column if not exists entered_value text;  -- what student typed for SPR
```

`chosen_index` stays nullable and is set for mcq responses; `entered_value` is set for spr responses. Existing rows default to mcq with `entered_value = null`, no backfill needed. The `sat.save_attempt` RPC needs an update to write the new columns.

## SPR answer parser

A pure helper at [app/lib/spr.ts](../../app/lib/spr.ts) (new file):

```ts
// Parses an SPR-style answer string into a rational form for comparison.
// Accepts: integer, decimal, fraction "a/b", negative versions of each.
// Mixed numbers ("1 1/2") are deliberately NOT accepted (real SAT semantics).
// Returns null on parse failure.
export interface ParsedSpr {
  value: number;          // canonical numeric value (for tolerance compare)
  isExact: boolean;       // true for fractions and clean decimals
  raw: string;            // the input, trimmed
}
export function parseSpr(input: string): ParsedSpr | null;

// Compares a student's entered value against the question's canonical answer.
// Uses exact-rational compare first; falls back to tolerance compare when the
// answer has answer_tolerance set OR the student's answer is decimal.
export function isSprCorrect(
  entered: string,
  canonical: string,
  tolerance: number | null,
): boolean;
```

Acceptance rules:

| Input form | Examples | Accepted? |
|---|---|---|
| Integer | `7`, `-5`, `0` | ✅ |
| Decimal | `3.14`, `-0.5`, `.5` | ✅ |
| Fraction | `1/2`, `-3/4`, `7/12` | ✅ |
| Mixed number | `1 1/2` | ❌ (use `3/2` or `1.5`) |
| Empty / whitespace | `""`, `" "` | ❌ (treated as unanswered) |
| Non-numeric | `abc`, `1.2.3` | ❌ |

Covered by [scripts/check-spr.ts](../../scripts/check-spr.ts) — scripted assertions in the project's style (no test runner here).

## Runner UI changes

### Test page — question rendering

The renderer (called from `SatPractice.tsx` or wherever the question UI lives) branches on `question.response_format`:

- `'mcq'`: unchanged — radio list over `choices`.
- `'spr'`: a labelled `<input type="text" inputmode="numeric" pattern="[0-9./\-]*">` plus a one-line format hint (`"Enter a number or fraction, e.g. 3, 3.14, or 3/4"`). State stored as a string in `responses[secIdx][qIdx]` (replacing the existing number-or-null for spr questions).

### Test page — tools (Math section only)

Two collapsible side panels, each toggled by a button in the top bar of the test page. Buttons render only when `currentSection === 'math'`. Panels:

- **Calculator panel** — fixed-position overlay on the right side of the viewport, ~420px wide, contains an `<iframe src="https://www.desmos.com/scientific?embed" loading="lazy" />`. Resizable would be nice; deferred to a polish iteration. Closes with an X.
- **Reference panel** — same layout, contains the static formula list (HTML+CSS). No JS, no fetches.

Both panels are unmounted when the section transitions to R&W. State is kept in `useTestSession` so they can be re-opened on subsequent Math sections (Full mode has only one Math section anyway today).

### Reference sheet content

```
Triangle:      A = ½bh
Rectangle:     A = lw
Circle:        A = πr²  ·  C = 2πr
Pythagorean:   a² + b² = c²
30-60-90:      sides in ratio 1 : √3 : 2
45-45-90:      sides in ratio 1 : 1 : √2

Volume:
  Box / prism:    V = lwh
  Cylinder:       V = πr²h
  Sphere:         V = ⁴⁄₃ πr³
  Cone:           V = ⅓ πr²h
  Pyramid:        V = ⅓ lwh

Angles:
  Sum of triangle interior angles = 180°
  Degrees in a circle = 360°
  Radians in a circle = 2π
```

Matches the College Board's official Digital SAT formula sheet.

## Generator changes

### Schema-side

Update [app/lib/ai/schema.ts](../../app/lib/ai/schema.ts):

```ts
export const generatedQuestionSchema = z.discriminatedUnion('responseFormat', [
  z.object({
    responseFormat: z.literal('mcq'),
    section: z.enum(['rw','math']),
    skill: z.string().min(1),
    passage: z.string().optional(),
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).length(4),
    answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(1),
  }),
  z.object({
    responseFormat: z.literal('spr'),
    section: z.literal('math'),         // SPR is Math-only per College Board
    skill: z.string().min(1),
    prompt: z.string().min(1),
    correctAnswer: z.string().min(1),
    answerTolerance: z.number().optional(),
    explanation: z.string().min(1),
  }),
]);
```

R&W is mcq-only — enforced by the schema.

### Prompt-side

The generator's prompt (in `app/lib/ai/ollama.ts` and the n8n Plan Batches `buildPrompt` function) gets an SPR branch. The picker decides per-batch: when targeting a Math skill, ~25% chance the requested format is SPR; otherwise mcq. Implemented as a per-batch coin-flip at the top of `buildPrompt`.

### Self-verify

Currently the solve call asks for a 0–3 index. For SPR questions, the solve call asks for a numeric answer string, and `isSprCorrect()` compares it to `correctAnswer`. Mcq path is unchanged.

### `runGeneration()` / Parse Candidates

Insert path branches on `responseFormat`: mcq rows write `choices` + `answer_index` (existing); spr rows write `correct_answer` + `answer_tolerance` (new) with placeholder `choices: []` + `answer_index: 0`.

## save_attempt RPC update

The RPC takes the `p_responses` array and writes per-response rows. Each row's `response_format`, `chosen_index` (mcq), and `entered_value` (spr) need to come from the client. `is_correct` is computed at save time:

- mcq: `chosen_index = answer_index` (unchanged)
- spr: `isSprCorrect(entered_value, correct_answer, answer_tolerance)` — implemented in plpgsql with a numeric-cast comparison and an exact-string fallback for fractions

Pure Postgres SPR compare (no JS round-trip):

```sql
create or replace function sat.spr_is_correct(
  entered text,
  canonical text,
  tolerance numeric
) returns boolean
language plpgsql
immutable
as $$
declare
  v_entered_num numeric;
  v_canonical_num numeric;
begin
  if entered is null or canonical is null then return false; end if;
  if btrim(entered) = btrim(canonical) then return true; end if;  -- exact string

  -- Try numeric parse on both sides (handles "1/2" via simple eval below).
  begin
    v_entered_num   := sat.spr_to_numeric(entered);
    v_canonical_num := sat.spr_to_numeric(canonical);
  exception when others then
    return false;
  end;
  if v_entered_num is null or v_canonical_num is null then return false; end if;

  if tolerance is not null then
    return abs(v_entered_num - v_canonical_num) <= tolerance;
  end if;
  return v_entered_num = v_canonical_num;
end;
$$;

create or replace function sat.spr_to_numeric(s text)
returns numeric
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  s := btrim(s);
  if s = '' then return null; end if;
  if s ~ '^-?\d+(\.\d+)?$' then return s::numeric; end if;
  if s ~ '^-?\d+/\d+$' then
    parts := string_to_array(s, '/');
    if parts[2]::numeric = 0 then return null; end if;
    return parts[1]::numeric / parts[2]::numeric;
  end if;
  return null;  -- mixed numbers, anything else
end;
$$;
```

Stays in Postgres (no service-role round-trip) and `save_attempt` invokes it inline.

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/20260525010000_sat_questions_format.sql` | NEW — schema addition + check constraint |
| `supabase/migrations/20260525020000_sat_attempt_responses_format.sql` | NEW — schema addition |
| `supabase/migrations/20260525030000_sat_spr_helpers.sql` | NEW — `sat.spr_to_numeric()` + `sat.spr_is_correct()` + updated `sat.save_attempt` |
| [app/lib/spr.ts](../../app/lib/spr.ts) | NEW — `parseSpr`, `isSprCorrect`, types |
| `scripts/check-spr.ts` | NEW — scripted parser assertions |
| [app/lib/questions.ts](../../app/lib/questions.ts) | Modify — extend `Question` type with `response_format`, `correct_answer`, `answer_tolerance` fields. `rowToQuestion` and `responseToQuestion` updates. |
| [app/lib/test.ts](../../app/lib/test.ts) | Modify — `Test` type's `responses` becomes `(number \| string \| null)[][]`. `shuffleChoices` is no-op for spr. `computeResults` branches on response_format. |
| [app/hooks/useTestSession.ts](../../app/hooks/useTestSession.ts) | Modify — `selectChoice` becomes `setAnswer` (string \| number). |
| [app/components/SatPractice.tsx](../../app/components/SatPractice.tsx) (or the question renderer it composes) | Modify — branch on `response_format`: mcq radios vs spr text input. Calculator + Reference buttons + panels (Math only). |
| [app/lib/ai/schema.ts](../../app/lib/ai/schema.ts) | Modify — discriminated union mcq \| spr. |
| [app/lib/ai/ollama.ts](../../app/lib/ai/ollama.ts) | Modify — SPR prompt branch; SPR solve branch; ~25% SPR coin-flip for Math. |
| [app/lib/ai/generate.ts](../../app/lib/ai/generate.ts) | Modify — insert path branches on responseFormat. |
| [app/lib/persistence/payload.ts](../../app/lib/persistence/payload.ts) | Modify — payload carries `response_format`, `chosen_index` or `entered_value`. |
| [app/lib/persistence/queries.ts](../../app/lib/persistence/queries.ts) | Modify — `AttemptResponseRow` gains the new fields. `responseToQuestion` handles spr. |
| `app/components/SprInput.tsx` | NEW — the SPR input component (numeric/fraction text input with hint). |
| `app/components/test/CalculatorPanel.tsx` | NEW — Desmos iframe panel. |
| `app/components/test/ReferencePanel.tsx` | NEW — static formula sheet panel. |
| n8n workflow Plan Batches node | Modify — SPR coin-flip + prompt branch. Parse Candidates discriminator. Insert body for spr. |
| [CLAUDE.md](../../CLAUDE.md) | Modify — document SPR question type, save flow, and the calc/ref panels. |
| [README.md](../../README.md) | Modify — brief mention of SPR + tools. |

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SPR answer parser misjudges equivalent forms (`1/2` vs `0.5`) | Medium | High | The pure JS parser + the Postgres helper share a spec. `scripts/check-spr.ts` covers ~30 cases. The Postgres helper does exact string + numeric compare in that order. |
| AI generates SPR questions with ambiguous correct answers | Medium | Medium | Self-verify (model re-solves and we compare with `isSprCorrect`) catches mismatches before insert. Same gate that exists for mcq. |
| Desmos iframe blocked by CSP or breaks on mobile | Low | Low | Test in dev; the test runner doesn't depend on it (it's an optional tool). Fall back to "Calculator unavailable" message. |
| Storing string `entered_value` makes analytics harder | Low | Low | Analytics already uses `is_correct` boolean — that aggregation is unaffected by the new column. |
| Existing 318 questions all mcq → mcq/spr mix takes time to balance | Low | Low | Generator at 25% spr probability fills in. Floor gate ensures new Math skills get spr questions too as they fill. |

## Verification

Manual checks after deploy:

1. `pnpm type-check` passes
2. `pnpm dlx tsx scripts/check-spr.ts` passes — ~30 parser assertions
3. SQL: `select response_format, count(*) from sat.questions group by 1` — initially all `'mcq'`; over the next ~24h of n8n runs, `'spr'` rows appear (target ~25% of new Math questions)
4. Take a Quick Math test on the deployed app: at least one question should be SPR (visible as a text input instead of radios); calc + ref buttons visible in the top bar of the Math section; clicking each opens a panel
5. Submit a test with one wrong SPR and one right SPR answer; `is_correct` correctly set on both rows
6. R&W section: no calc / ref buttons; no SPR (all radio mcq)

## Out of scope

- **Graphing calculator.** Use scientific Desmos for now. Swap to graphing later by changing one iframe URL.
- **Movable / resizable panels.** Fixed-position overlays for v1. Polish iteration.
- **Backfilling existing 318 mcq questions to spr.** They stay mcq forever; new generation creates spr rows from now on.
- **Bluebook-style "Mark for review", annotations, line strike-through, eliminate distractor.** Separate UX work.
- **Score validity / IRT scoring.** Sub-project #10.
- **Adaptive 2-module structure.** Sub-project #11.

## Approval

Things specifically worth your eyeball:

1. **SPR scope** — accept integer/decimal/fraction; reject mixed number. Match real SAT? ✅
2. **SPR generation rate** — 25% of newly generated Math questions are SPR. Adjustable in Config; want a different number?
3. **Reference sheet content** — matches College Board's published list. Anything you want added/removed?
4. **Desmos scientific (not graphing)** — willing to upgrade to graphing later if needed. OK for v1?
5. **Migration strategy** — three small migrations rather than one big one. All NULL-safe / default-safe, no backfill required. OK?
