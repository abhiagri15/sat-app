# SAT Prep — Foundation Sub-Project Design

**Date:** 2026-05-21
**Status:** Approved for plan-writing
**Sub-project:** #1 of 6 — Foundation
**Audience:** Future implementer (human or AI) executing the migration

---

## 1. Context: where this fits in the larger product

The existing `sat-app/` is a static one-page Next.js 14 + plain-JS application: a name field, a timed SAT practice test sampled from a hardcoded `BANK` of ~30 questions, an instant results screen with worked explanations. No authentication, no persistence, no analytics.

The product goal is a full SAT-prep platform for high-school students in the US: accounts (email + Google OAuth via Supabase), AI-generated SAT-style questions with self-verified quality, persisted attempt history and per-question responses, analytics on per-skill mastery and score-over-time, and feedback/insights derived from that data.

That scope is too large for a single spec. It is decomposed into six sub-projects, each with its own spec → plan → implementation cycle:

| # | Sub-project | What it delivers |
|---|---|---|
| **1** | **Foundation** *(this spec)* | Stack/tooling migration to the OneReal-aligned stack, App Router restructure, component decomposition, Supabase clients wired up, `sat` PostgreSQL schema created. **Same SAT gameplay as today**, on the architecture every later sub-project plugs into. Still uses the hardcoded `BANK` as its question source. |
| 2 | AI question generation | Pluggable `AIProvider` interface with adapters for Gemini, OpenAI, Claude, and Ollama Cloud. Pool of AI-generated questions in `sat.questions` (seeded with the current `BANK`). On-demand pool top-up at test start, schema + self-verify quality gate, normalized-text dedup. Provider selected via `SAT_AI_PROVIDER` env var. |
| 3 | Auth | Supabase auth: email signup + Google OAuth. `sat.profiles` table, auto-created on first login. Protected routes. |
| 4 | Persistence | `sat.test_attempts` + `sat.attempt_responses` tables; save the full attempt at test submission; "History" list on `/dashboard`. |
| 5 | Analytics | Score-over-time chart, per-section breakdown, per-skill accuracy. |
| 6 | Feedback / insights | Auto-generated recommendations derived from analytics. |

Foundation is intentionally narrow: it makes no functional changes to the user-facing test. Its purpose is to land the architecture so the next five sub-projects can be built incrementally.

---

## 2. Scope

### 2.1 In scope

- Package manager: **npm → pnpm**.
- Framework bump: **Next.js 14 → 15**.
- Language: **plain JavaScript → TypeScript** with `strict: true`.
- UI primitives: **shadcn/ui** initialized; generate base components (`button`, `card`, `input`, `label`, `dialog`). **Tailwind CSS** replaces `SatPractice.module.css`.
- Libraries staged (installed; minimal use in Foundation): **TanStack Query** (a `<QueryClientProvider>` is wired in `layout.tsx`), **react-hook-form** + **zod** (installed, no consumers yet — Auth sub-project uses them).
- Supabase clients: `@supabase/supabase-js` and `@supabase/ssr` installed; `app/lib/supabase/{client,server}.ts` configured against the **PropLedger** Supabase project (`falgykkspbtrwdcchayi`). One server-side `select 1` smoke test on `/dashboard` to prove SSR + cookies work, removed once Auth lands.
- **`sat` PostgreSQL schema** created via Supabase CLI migration; deny-by-default RLS posture established. **No tables yet** — tables come with their respective sub-projects.
- App Router restructure:
  - `/` runs the current SAT gameplay.
  - `/dashboard` is a placeholder stub ("Sign in to see your history").
- Component decomposition of the current 390-line `SatPractice.jsx` into a `useTestSession` hook + pure `lib/test.ts` + seven presentational components.
- The question bank is moved to `app/lib/questions.ts`, with a `Question` TypeScript interface whose shape matches the eventual `sat.questions` row shape. The renamed field `answer` → `answerIndex` and the new `source: 'seed'` field are applied here so the AI sub-project can adopt the type without reshaping.

### 2.2 Out of scope (explicitly deferred)

- **No authentication.** No login UI, no protected routes, no `auth.users` linkage.
- **No `sat.profiles`, `sat.test_attempts`, `sat.attempt_responses`, or `sat.questions` tables.** Only the `sat` schema namespace.
- **No AI integration.** No provider adapters, no pool top-up, no `SAT_AI_PROVIDER` env var.
- **No data persistence of any kind.** Test results remain in-memory only; refresh wipes them, identical to today.
- **No analytics or feedback features.**
- **No new question content.** The 30 hardcoded `BANK` items continue as the sole question source.
- **No test runner or test suites.** Verification is `pnpm type-check` + `pnpm build` + manual click-through. Aligns with OneReal's convention (per `onereal_project.md`: "No automated test suite. The project's gate is `pnpm type-check`.").

### 2.3 Acceptance criteria

After Foundation completes:

1. `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm type-check`, and `pnpm lint` all succeed.
2. Visiting `/` produces a functional SAT test: name entry, test-length choice (Quick or Full), timed sections, navigation, submit, results with score and review.
3. Visiting `/dashboard` shows a placeholder card and (server-side) the Supabase smoke test logs success.
4. Timer behavior is identical to the pre-migration app: per-section countdown, color thresholds (≤30s danger, ≤120s warn), auto-advance on zero, identical scoring formula.
5. Question and answer-choice shuffling behave identically.
6. The `sat` schema exists in the PropLedger Supabase project with deny-by-default privileges.
7. No code references `SatPractice.module.css`; the file is deleted.

---

## 3. Architecture decisions (locked)

Each decision was made through brainstorming with the stakeholder. The rationale is captured for future re-evaluation.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Stack matches OneReal:** Next.js 15 + TypeScript + pnpm + `@supabase/ssr` + shadcn/ui + TanStack Query + react-hook-form + zod. | The stakeholder already runs this stack in another personal project (OneReal). Reusing the pattern minimizes onboarding cost, makes auth a known quantity, and lets future contributors share mental models across projects. |
| D2 | **Reuse the PropLedger Supabase project** (`falgykkspbtrwdcchayi`) rather than create a dedicated SAT project. SAT objects live under a dedicated `sat` PostgreSQL schema to keep namespaces clean. | Stakeholder preference. The schema namespacing mitigates the coupling concern (backups, RLS, drop-the-whole-schema escape hatch). PropLedger is accessible via the claude.ai Supabase MCP, simplifying migrations. |
| D3 | **In-place upgrade of `sat-app/`** rather than a greenfield rewrite or monorepo restructure. | Smallest setup cost. The current app has so little surface that in-place conversion is faster than copying logic to a new repo. Monorepo deferred until a second app (e.g., admin dashboard) is actually needed. |
| D4 | **Foundation ships on the hardcoded `BANK`.** AI generation is its own sub-project. | Decoupling stack migration from content migration. Lets us verify the new stack against deterministic content before introducing AI variability. The `BANK` is preserved long-term as the seed pool and offline-dev fallback. |
| D5 | **Component decomposition: three screen components plus four sub-components** (TopBar, QuestionView, QuestionNavigator, ReviewItem). State lives in a single `useTestSession` hook that wraps `useState` calls — **not a reducer**, **not a context provider**. | Closest to the current code, fastest to verify behavior parity, no over-engineering. A reducer or context can be introduced later if state grows. |
| D6 | **Tailwind + shadcn cutover happens inside Foundation**, not in a separate sub-project. `SatPractice.module.css` is deleted. | Every component file is being touched during JS→TS conversion anyway; doing the className rewrite in the same pass avoids a second visit. Accepts a known visual divergence from the pre-migration UI. |
| D7 | **No tables in Foundation.** Only `CREATE SCHEMA sat;` and the deny-by-default RLS posture. | Tables couple naturally to the sub-project that uses them. `sat.profiles` requires `auth.users` (Auth sub-project); `sat.questions` requires the AI sub-project's lifecycle; `sat.test_attempts` requires Persistence. Creating empty tables now would invite premature schema decisions. |
| D8 | **No automated tests in Foundation.** Verification is type-check + manual browser click-through. | Matches OneReal convention. Adding a test runner expands Foundation's surface for no immediate functional payoff. Re-evaluate if a future sub-project needs unit tests for non-trivial pure logic (e.g., AI dedup hashing, score aggregation). |

### Decisions deferred to later sub-projects (recorded for traceability)

These were settled during brainstorming but apply to sub-projects #2–#6, not Foundation. Captured here so the future implementer doesn't re-litigate them.

| Decision | Sub-project |
|---|---|
| AI provider abstraction with Gemini / OpenAI / Claude / Ollama Cloud adapters; selection via `SAT_AI_PROVIDER` env var. | #2 |
| Pre-warmed pool in `sat.questions`, sampled randomly across users; pool top-up triggered on-demand at test start, non-blocking. | #2 |
| Quality gate: zod schema validation + self-verify (the model re-solves its own question; mismatch → reject). | #2 |
| Deduplication: normalized-text exact-match hash of `(prompt + choices)`, lowercased, whitespace-stripped. | #2 |
| Explanation generated with the question and stored once on `sat.questions.explanation`. Same explanation shown to every user. | #2 |
| `BANK` seeds `sat.questions` on the first AI-sub-project migration. After seeding, `BANK` survives in code as a fallback fixture when the pool is empty AND the AI provider is failing. | #2 |
| Auth via Supabase: email signup + Google OAuth. `sat.profiles` auto-created on first login with FK to `auth.users(id)`. | #3 |
| Persistence captures **per-question responses** (`sat.attempt_responses`), not just aggregate scores. | #4 |

---

## 4. Target file structure

```
sat-app/
├── package.json
├── pnpm-lock.yaml                          # committed (none today)
├── tsconfig.json                           # strict: true
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json                         # shadcn config
├── .env.local                              # gitignored
├── .env.example                            # committed template
├── .gitignore                              # existing; verify includes .env.local
├── jsconfig.json                           # DELETED (replaced by tsconfig.json)
│
├── app/
│   ├── layout.tsx                          # wraps children in <Providers>
│   ├── globals.css                         # Tailwind directives + minimal residual styles
│   ├── providers.tsx                       # 'use client'; <QueryClientProvider>
│   ├── page.tsx                            # renders <SatPractice/>
│   ├── dashboard/
│   │   └── page.tsx                        # placeholder + server-side select 1 smoke test
│   │
│   ├── lib/
│   │   ├── questions.ts                    # typed BANK + Question interface
│   │   ├── test.ts                         # pure logic + Test, TestSection, Results types
│   │   └── supabase/
│   │       ├── client.ts                   # createBrowserClient
│   │       └── server.ts                   # createServerClient (cookies-aware)
│   │
│   ├── hooks/
│   │   └── useTestSession.ts               # all useState + timer effect + actions
│   │
│   └── components/
│       ├── SatPractice.tsx                 # ~30 lines; FSM router
│       ├── StartScreen.tsx
│       ├── TestScreen.tsx
│       ├── ResultsScreen.tsx
│       ├── TopBar.tsx
│       ├── QuestionView.tsx
│       ├── QuestionNavigator.tsx
│       ├── ReviewItem.tsx
│       └── ui/                             # shadcn-generated primitives
│           ├── button.tsx
│           ├── card.tsx
│           ├── input.tsx
│           ├── label.tsx
│           └── dialog.tsx
│
├── supabase/
│   ├── config.toml
│   └── migrations/
│       └── 20260521000000_sat_schema.sql   # CREATE SCHEMA + deny-by-default
│
└── docs/superpowers/
    ├── specs/
    │   └── 2026-05-21-sat-app-foundation-design.md   # this document
    └── plans/                              # implementation plans land here
```

### Files explicitly deleted in Foundation

- `app/SatPractice.jsx` (split into `app/components/*.tsx` + `app/hooks/useTestSession.ts` + `app/lib/test.ts`)
- `app/SatPractice.module.css` (replaced by Tailwind utilities + shadcn components)
- `app/page.module.css` (unused in current code; verify and remove)
- `app/page.js`, `app/layout.js`, `app/questions.js`, `next.config.js`, `jsconfig.json` (replaced by `.tsx`/`.ts` equivalents and `tsconfig.json`)

---

## 5. Migration path (ordered steps)

The migration is sequenced so the app remains runnable at each step boundary (or, in worst case, broken for a single commit). Each numbered step is one logical commit.

### Step 1 — Initialize git

`sat-app/` is not currently a git repo. `git init`, add a `.gitignore` if missing (verify `node_modules`, `.env.local`, `.next/`, `supabase/.temp/` are ignored), initial commit of the existing JS app. Tag `pre-ts-migration` so the final diff is reviewable.

### Step 2 — Switch package manager: npm → pnpm

- Delete `node_modules` if present.
- `pnpm install` (no `package-lock.json` exists today, so no conflict).
- Add `packageManager: "pnpm@<version>"` to `package.json`.
- Verify `pnpm dev` boots the unmodified JS app.

### Step 3 — Bump Next.js 14 → 15

- Update `next` in `package.json` to `15.x`.
- `pnpm install`.
- Resolve Next 15 deprecation warnings (App Router APIs are largely compatible; expect minor changes around `cookies()` / `headers()` returning Promises, but those don't apply to the current code).
- Verify gameplay in the browser end-to-end.

### Step 4 — Add TypeScript with strict mode

- Create `tsconfig.json` with strict mode and App Router-aware compiler options.
- Install `typescript`, `@types/react`, `@types/react-dom`, `@types/node`.
- Convert files **one at a time**, each as its own commit, in this order:
  1. `next.config.js` → `next.config.ts`
  2. `app/layout.js` → `app/layout.tsx`
  3. `app/page.js` → `app/page.tsx`
  4. `app/questions.js` → `app/lib/questions.ts` (add `Question` interface; rename `answer` → `answerIndex`; add `source: 'seed'` to every entry; assign stable `id` strings like `seed-rw-001`)
  5. Extract pure helpers from `SatPractice.jsx` into `app/lib/test.ts` (`shuffle`, `shuffleChoices`, `buildTest`, `computeResults`, `fmtTime`, `LETTERS`, plus `Test`/`TestSection`/`Results` types). `buildTest` takes `bank: Question[]` as a parameter rather than importing `BANK` directly — this prepares the seam for the AI sub-project.
  6. Extract `useTestSession` hook into `app/hooks/useTestSession.ts`. Internal state stays as discrete `useState` calls — no reducer.
  7. Decompose UI into seven components under `app/components/`: `StartScreen.tsx`, `TestScreen.tsx`, `ResultsScreen.tsx`, `TopBar.tsx`, `QuestionView.tsx`, `QuestionNavigator.tsx`, `ReviewItem.tsx`.
  8. Shrink `SatPractice.jsx` into `app/components/SatPractice.tsx` (~30 lines: call hook, switch on `screen`, render one of three screens).

After Step 4, the app runs on TS but still uses the original CSS module.

### Step 5 — Stub `/dashboard` route

`app/dashboard/page.tsx`: a placeholder card explaining that history will appear after sign-in (Auth sub-project fills this in). Disabled "Sign in" button for visual completeness.

### Step 6 — Tailwind + shadcn cutover

- `pnpm dlx tailwindcss init -p`; populate `tailwind.config.ts` `content` paths.
- Replace `app/globals.css` with Tailwind directives plus any minimal residual global styles.
- `pnpm dlx shadcn@latest init` (configure `components.json` for the App Router, TS, Tailwind).
- Generate base primitives: `button`, `card`, `input`, `label`, `dialog`.
- Rewrite every component's classNames from `SatPractice.module.css` classes to Tailwind utilities, swapping primitives (`<button class="btnPrimary">` → shadcn `<Button>`, etc.).
- Delete `app/SatPractice.module.css` and `app/page.module.css`.

**Known divergence:** the visual look will change in this step. There is no plan for pixel-parity with the pre-migration UI. The interaction behavior (timer, navigation, scoring) must remain identical.

### Step 7 — Wire TanStack Query + RHF + zod

- Install `@tanstack/react-query`, `react-hook-form`, `zod`.
- Create `app/providers.tsx` (`'use client'`) with `<QueryClientProvider>`.
- Wrap `<Providers>` around `{children}` in `app/layout.tsx`.
- RHF and zod are installed but unused in Foundation — Auth sub-project consumes them.

### Step 8 — Supabase clients + `sat` schema migration

- Install `@supabase/supabase-js`, `@supabase/ssr`.
- Create `app/lib/supabase/client.ts` (browser client via `createBrowserClient`) and `app/lib/supabase/server.ts` (server client via `createServerClient` + `next/headers`).
- Populate `.env.local` and commit `.env.example`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://falgykkspbtrwdcchayi.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase dashboard>
  ```
- `pnpm dlx supabase init` to create the `supabase/` workspace.
- `pnpm dlx supabase link --project-ref falgykkspbtrwdcchayi` (will require the Supabase access token).
- Write `supabase/migrations/20260521000000_sat_schema.sql`:
  ```sql
  create schema if not exists sat;

  revoke all on schema sat from anon, authenticated;
  grant usage on schema sat to anon, authenticated;

  alter default privileges in schema sat
    revoke all on tables from anon, authenticated;
  alter default privileges in schema sat
    revoke all on sequences from anon, authenticated;
  alter default privileges in schema sat
    revoke all on functions from anon, authenticated;
  ```
- Apply via `pnpm dlx supabase db push` OR via the claude.ai Supabase MCP (`mcp__claude_ai_Supabase__apply_migration`). PropLedger is MCP-accessible per `onereal_project.md`.
- Add a server-side `select 1` smoke call in `app/dashboard/page.tsx` (logs to server console; removed in Auth sub-project).

### Step 9 — Final verification

- `pnpm type-check` (no errors).
- `pnpm lint` (no errors; ESLint config remains Next.js default unless an issue surfaces).
- `pnpm build` (clean build).
- `pnpm dev` and manual click-through:
  - Enter name; verify Quick and Full test-length options both build correctly.
  - Run a complete Quick test from `/`. Verify timer counts down, color shifts at ≤120s (warn) and ≤30s (danger), auto-advance fires on zero, scoring matches a hand calculation, review screen renders explanations with bold formatting.
  - Visit `/dashboard`, confirm placeholder renders and server logs the Supabase smoke test result.
- Tag `post-foundation`.

---

## 6. State and component design

### 6.1 `useTestSession` hook surface

```ts
export function useTestSession(): {
  // state
  screen: 'start' | 'test' | 'results';
  name: string;
  setName: (s: string) => void;
  testLength: 'short' | 'full';
  setTestLength: (l: 'short' | 'full') => void;
  test: Test | null;
  secIdx: number;
  qIdx: number;
  responses: (number | null)[][];        // responses[secIdx][qIdx]
  remaining: number[];                   // remaining[secIdx], seconds
  showReview: boolean;
  toggleReview: () => void;
  // actions
  start: () => void;                     // validates name, builds test, transitions
  selectChoice: (i: number) => void;     // for current (secIdx, qIdx)
  goToQuestion: (qi: number) => void;
  submitSection: () => void;             // confirms, advances or finishes
  newTest: () => void;                   // returns to start screen
  results: Results | null;               // non-null only when screen === 'results'
};
```

Implementation notes:
- Internal state uses discrete `useState` calls (no reducer).
- The timer effect remains tied to `[screen, secIdx]` deps — restarting on section change is load-bearing behavior.
- `handleTimeUp` uses `setTimeout(handleTimeUp, 0)` to defer the advance out of the `setInterval` callback and avoid setState-mid-render.
- `setResponses` and `setRemaining` use functional updates (`prev => ...`) to avoid stale closures.

### 6.2 Component responsibilities

| Component | Props | Responsibility |
|---|---|---|
| `SatPractice.tsx` | none | Top-level FSM router. Calls `useTestSession()` and renders the active screen. ~30 lines. |
| `StartScreen.tsx` | `{ name, setName, testLength, setTestLength, onStart }` | Name input, Quick/Full toggle, Start button. Pure presentational. |
| `TestScreen.tsx` | `{ test, secIdx, qIdx, responses, remaining, onSelect, onGoToQuestion, onSubmitSection }` | Composes `TopBar`, `QuestionView`, `QuestionNavigator`. Picks `section = test.sections[secIdx]` and `question = section.questions[qIdx]` from props. |
| `TopBar.tsx` | `{ secIdx, qIdx, totalQ, name, remaining }` | The "Section · Question · timer · name" header. Owns timer color thresholds: ≤30s = danger, ≤120s = warn. |
| `QuestionView.tsx` | `{ question, selected, onSelect, onPrev, onNext, isFirst, isLast }` | Renders optional passage, prompt, choice list, prev/next controls. |
| `QuestionNavigator.tsx` | `{ section, qIdx, responses, onGoToQuestion, onSubmitSection, isLastSection }` | Numbered button grid (with answered/current state) plus "Submit section" / "Submit test" button. |
| `ResultsScreen.tsx` | `{ test, responses, results, showReview, onToggleReview, onNewTest }` | Score box, per-section breakdown, "Start a New Test" / "Show full review" buttons. Renders `<ReviewItem>` list when `showReview`. |
| `ReviewItem.tsx` | `{ question, chosenIndex }` | One reviewed question: skill tag, correct/incorrect/skipped badge, the user's answer, the correct answer (if wrong), and the explanation. Explanations continue to use `dangerouslySetInnerHTML` because `BANK` content is trusted and contains `<b>` tags — this constraint is documented inline. |

### 6.3 Pure logic in `app/lib/test.ts`

```ts
export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

export interface Test {
  name: string;
  sections: TestSection[];
}
export interface TestSection {
  key: 'rw' | 'math';
  name: string;
  questions: Question[];                 // already shuffled; choices already shuffled
  timeLimit: number;                     // seconds
}
export interface Results {
  perSection: { name: string; correct: number; total: number }[];
  pct: number;
  scaled: number;
}

export function shuffle<T>(arr: T[]): T[];
export function shuffleChoices(q: Question): { choices: string[]; answerIndex: number };
export function buildTest(name: string, testLength: 'short' | 'full', bank: Question[]): Test;
export function computeResults(test: Test, responses: (number | null)[][]): Results;
export function fmtTime(sec: number): string;
```

`buildTest` accepts `bank` as an explicit parameter (instead of importing `BANK`). This is the seam that lets the AI sub-project pass a pool-sampled `Question[]` without changing call sites.

The scaled-score formula `Math.round((400 + pct * 1200) / 10) * 10` is preserved verbatim. It is acknowledged as a linear approximation, not a real SAT scale; this is a product decision recorded for traceability, not a Foundation concern.

### 6.4 `Question` type (in `app/lib/questions.ts`)

```ts
export interface Question {
  id: string;                  // stable; 'seed-rw-001'… for current BANK
  section: 'rw' | 'math';
  skill: string;
  passage?: string;
  prompt: string;
  choices: string[];
  answerIndex: number;         // renamed from `answer`
  explanation: string;         // may contain inline HTML (<b>, <i>) — trusted content
  source: 'seed' | 'ai';       // every Foundation row is 'seed'
}

export const BANK: Question[] = [ /* … 30 entries … */ ];
```

Designed to match the eventual `sat.questions` row shape so the AI sub-project only adds storage, not a type rewrite.

---

## 7. Supabase setup details

### 7.1 Environment variables

`.env.local` (gitignored):

```
NEXT_PUBLIC_SUPABASE_URL=https://falgykkspbtrwdcchayi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

`.env.example` (committed):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

The Supabase service-role key is **not** placed in `.env.local`. Service-role usage starts in the Auth and AI sub-projects and lives only in deployment env (Vercel).

### 7.2 Client files

`app/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

`app/lib/supabase/server.ts` follows the standard `@supabase/ssr` server-client pattern: reads/writes Supabase auth cookies via `next/headers`. Mirrors OneReal's `apps/web/lib/supabase/server.ts` (referenced in `onereal_project.md`).

### 7.3 Migration: `supabase/migrations/20260521000000_sat_schema.sql`

```sql
create schema if not exists sat;

-- deny-by-default: tables created later must explicitly grant + add RLS policies.
revoke all on schema sat from anon, authenticated;
grant usage on schema sat to anon, authenticated;

alter default privileges in schema sat
  revoke all on tables from anon, authenticated;
alter default privileges in schema sat
  revoke all on sequences from anon, authenticated;
alter default privileges in schema sat
  revoke all on functions from anon, authenticated;
```

Application path:
- **Preferred:** `mcp__claude_ai_Supabase__apply_migration` (PropLedger is MCP-accessible).
- **Alternative:** `pnpm dlx supabase db push` after `pnpm dlx supabase link --project-ref falgykkspbtrwdcchayi`.

### 7.4 Smoke test

`app/dashboard/page.tsx` is a server component that issues `select 1`-equivalent via the server client and logs the result. Purpose is to verify the SSR + cookie + connection plumbing end-to-end in the deployed app. This call and its log are removed when the Auth sub-project lands real session reads.

---

## 8. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Component decomposition (Step 4) silently changes timer or scoring behavior.** | Medium | High — invalidates the migration | Keep `useTestSession` as discrete `useState` calls (no reducer). Preserve `useEffect` deps `[screen, secIdx]`. Preserve `setTimeout(handleTimeUp, 0)` defer. Final verification (Step 9) includes a full manual end-to-end test. |
| **Tailwind cutover (Step 6) introduces visual regressions stakeholder didn't anticipate.** | High | Low — purely cosmetic | Acknowledged explicitly in scope (D6). Behavior is unchanged. If pixel-parity is later requested, it becomes its own sub-project. |
| **Schema migration on the shared PropLedger DB causes unintended side effects on the PropLedger app.** | Low | High — touches production data of an unrelated project | Migration is purely additive: creates a new isolated schema, revokes privileges, no tables. Apply via Supabase branch first if extra caution is wanted (stakeholder noted as optional during brainstorming). |
| **Supabase CLI link state lost after `git clone` or worktree creation.** | Medium | Low — easily fixed | `supabase/.temp/` is gitignored. Documented in repo README that a fresh checkout needs `pnpm dlx supabase link --project-ref falgykkspbtrwdcchayi`. Aligns with the OneReal worktree gotcha noted in `onereal_project.md`. |
| **`dangerouslySetInnerHTML` in `ReviewItem` becomes an XSS vector once questions come from AI (sub-project #2).** | Low (in Foundation) / Medium (later) | High once user-generated content enters | Out of scope for Foundation. Flagged here for the AI sub-project: either sanitize at insert time, or move to a constrained renderer (e.g., `react-markdown` with an allowlist), or strip HTML and render plain text + a small allowed subset. |
| **Next.js 15 surfaces an unexpected breaking change.** | Low | Medium | Step 3 is isolated; if a blocker appears we hold at Next 14, since the Supabase SSR helpers support both. |

---

## 9. Verification (manual checklist run at Step 9)

- [ ] `pnpm install` succeeds.
- [ ] `pnpm type-check` reports 0 errors.
- [ ] `pnpm lint` reports 0 errors.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm dev` starts on `http://localhost:3000`.
- [ ] `/` renders the StartScreen.
- [ ] Name validation: clicking Start with an empty name shows an alert and does not transition.
- [ ] Quick test (10 + 10) builds with two sections of 10 questions each.
- [ ] Full test builds with all available questions per section.
- [ ] Timer starts at correct duration (`shortCount * secsPerQ` per section).
- [ ] Timer color changes at the 120-second mark and again at the 30-second mark.
- [ ] Timer hits 0 → alert fires → section advances (or test submits if last section).
- [ ] Question navigator highlights answered questions and the current question.
- [ ] Submit-section confirmation appears; canceling does not advance; confirming does.
- [ ] Results screen shows a scaled score in the 400–1600 range that matches the formula `round((400 + correct/total * 1200) / 10) * 10`.
- [ ] "Show full review" reveals every question with the user's pick, the correct answer (when wrong), and an explanation that renders `<b>` as bold.
- [ ] "Start a New Test" returns to the StartScreen with state reset and reshuffles questions on next start.
- [ ] `/dashboard` renders the placeholder and the server logs reflect the successful Supabase smoke test.
- [ ] The `sat` schema exists in the PropLedger Supabase project (`select * from pg_namespace where nspname = 'sat';` returns one row).
- [ ] Anonymous role cannot create or read in `sat` (verified via SQL editor with `set role anon;`).

---

## 10. Glossary and references

- **PropLedger Supabase project:** `falgykkspbtrwdcchayi` — accessible via the claude.ai Supabase MCP. Hosts the existing PropLedger app and (after Foundation) the SAT-prep app under a dedicated `sat` schema.
- **OneReal project conventions:** `onereal_project.md` in user memory — captures the stack (Next.js 15 + TS + pnpm + Supabase + shadcn) we are matching here, plus the Supabase CLI gotchas around `supabase/.temp/` and worktrees.
- **Brainstorming session that produced this spec:** 2026-05-21, recorded in conversation history. Stakeholder approved each of Sections 1–5 of the verbal design before this document was written.

---

## 11. Next steps after this spec is approved

1. Spec review loop (spec-document-reviewer subagent).
2. Stakeholder review of this document.
3. Invoke the `superpowers:writing-plans` skill to produce a step-by-step implementation plan that maps the migration path (Section 5) into tracked tasks with concrete commits.
4. Execute the plan via `superpowers:executing-plans`.
