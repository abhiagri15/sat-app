# SAT-App Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the existing plain-JS Next.js 14 SAT practice app to TypeScript + Next.js 15 + pnpm + Tailwind + shadcn + Supabase clients, decompose the 390-line `SatPractice.jsx` into a hook + pure logic + seven presentational components, and create a `sat` PostgreSQL schema (no tables) in the PropLedger Supabase project. **User-facing gameplay must remain functionally identical.**

**Architecture:** In-place upgrade of `sat-app/`. State lives in a single `useTestSession` hook (top-level in `<SatPractice/>`), flows down via prop-drilling. Pure logic moves to `app/lib/test.ts`. Tailwind utilities + shadcn primitives replace `SatPractice.module.css`. Supabase access goes through `@supabase/ssr` browser/server client pair.

**Tech Stack:** Next.js 15, **React 19** (chosen to match the OneReal stack; Next 15 admits React 18.2+ in its peer range so React 19 is a deliberate alignment, not a strict requirement), TypeScript (`strict: true`), pnpm, Tailwind CSS, shadcn/ui, `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-query`, `react-hook-form`, `zod`.

**Spec:** [2026-05-21-sat-app-foundation-design.md](../specs/2026-05-21-sat-app-foundation-design.md)

**Verification model:** Foundation has no automated tests (Decision D8 in spec). Each task's verification is `pnpm type-check` + `pnpm build` + targeted manual browser checks. The Section 9 manual checklist in the spec runs at the end of Task 9 as the gate to tag `post-foundation`.

**Shell:** the project lives on Windows; the canonical shell is PowerShell 5.1. Steps below show **PowerShell** as the primary form; equivalent bash is shown as fallback for cross-platform clarity. Where only one form is given, it works in both shells.

**File-attribution notes for the Plan-wide File Structure table below:**
- `next.config.js → next.config.ts`: the rename is a Task 4 sub-step, not Task 3. Task 3 only bumps the `next` (and `react`) version inside the existing `next.config.js`/`package.json`.
- This plan file (`docs/superpowers/plans/2026-05-21-sat-app-foundation-implementation.md`) was committed at the end of the plan-writing session, **before** Task 1 starts. Task 1's expected `git status` reflects this — the plan is already tracked.

---

## Plan-wide File Structure

This is the target tree at the end of all tasks. Individual tasks identify which files they touch.

```
sat-app/
├── package.json                            # MODIFIED (deps, scripts, packageManager)
├── pnpm-lock.yaml                          # CREATED (Task 2)
├── tsconfig.json                           # CREATED (Task 4)
├── next.config.ts                          # CREATED (was next.config.js)
├── tailwind.config.ts                      # CREATED (Task 6)
├── postcss.config.mjs                      # CREATED (Task 6)
├── components.json                         # CREATED by `shadcn init` (Task 6)
├── .env.local                              # CREATED, gitignored (Task 8)
├── .env.example                            # CREATED, committed (Task 8)
├── .gitignore                              # MODIFIED (Task 1: append supabase/.temp/)
├── README.md                               # MODIFIED (Task 9)
├── CLAUDE.md                               # MODIFIED if any stale (Task 9)
│
├── jsconfig.json                           # DELETED (Task 4; replaced by tsconfig.json)
├── next.config.js                          # DELETED (Task 4; replaced by .ts)
│
├── app/
│   ├── layout.tsx                          # CREATED (was layout.js); wraps in <Providers>
│   ├── globals.css                         # MODIFIED (Task 6: Tailwind directives)
│   ├── providers.tsx                       # CREATED (Task 7); QueryClientProvider
│   ├── page.tsx                            # CREATED (was page.js); renders <SatPractice/>
│   ├── page.module.css                     # DELETED (Task 6; unused)
│   ├── SatPractice.jsx                     # DELETED (Task 4; replaced by components/)
│   ├── SatPractice.module.css              # DELETED (Task 6; replaced by Tailwind)
│   ├── questions.js                        # DELETED (Task 4; moved to lib/questions.ts)
│   │
│   ├── dashboard/
│   │   └── page.tsx                        # CREATED (Task 5); placeholder + smoke test
│   │
│   ├── lib/
│   │   ├── questions.ts                    # CREATED (Task 4); typed BANK + Question interface
│   │   ├── test.ts                         # CREATED (Task 4); pure logic + types
│   │   └── supabase/
│   │       ├── client.ts                   # CREATED (Task 8)
│   │       └── server.ts                   # CREATED (Task 8)
│   │
│   ├── hooks/
│   │   └── useTestSession.ts               # CREATED (Task 4)
│   │
│   └── components/
│       ├── SatPractice.tsx                 # CREATED (Task 4); thin FSM router
│       ├── StartScreen.tsx                 # CREATED (Task 4)
│       ├── TestScreen.tsx                  # CREATED (Task 4)
│       ├── ResultsScreen.tsx               # CREATED (Task 4)
│       ├── TopBar.tsx                      # CREATED (Task 4)
│       ├── QuestionView.tsx                # CREATED (Task 4)
│       ├── QuestionNavigator.tsx           # CREATED (Task 4)
│       ├── ReviewItem.tsx                  # CREATED (Task 4)
│       └── ui/                             # CREATED by `shadcn add` (Task 6)
│           ├── button.tsx
│           ├── card.tsx
│           ├── input.tsx
│           ├── label.tsx
│           └── dialog.tsx
│
├── supabase/                               # CREATED by `supabase init` (Task 8)
│   ├── config.toml
│   └── migrations/
│       └── 20260521000000_sat_schema.sql   # CREATED (Task 8)
│
└── docs/superpowers/
    ├── specs/
    │   └── 2026-05-21-sat-app-foundation-design.md   # already committed
    └── plans/
        └── 2026-05-21-sat-app-foundation-implementation.md   # this file
```

**Responsibilities of each new file:**

| File | Responsibility |
|---|---|
| `app/lib/questions.ts` | Typed seed question bank. The `Question` interface and the `BANK` constant. No logic. |
| `app/lib/test.ts` | Pure (React-free) test mechanics: shuffle, build, score, format. Plus `Test`/`TestSection`/`Results` types and the `LETTERS` constant. |
| `app/hooks/useTestSession.ts` | All `useState` calls for the FSM + the timer effect + action functions. The only place `'use client'` state lives. |
| `app/components/SatPractice.tsx` | Top-level FSM router. Calls `useTestSession()` and renders one of three screens. ~30 lines. |
| `app/components/StartScreen.tsx` | Pure UI: name input, test-length toggle, Start button. |
| `app/components/TestScreen.tsx` | Pure UI: composes `TopBar` + `QuestionView` + `QuestionNavigator`. Receives the already-extracted current `TestSection`, not the whole `Test`. |
| `app/components/TopBar.tsx` | Pure UI: section/question counter + timer with color thresholds + student name. |
| `app/components/QuestionView.tsx` | Pure UI: passage + prompt + choice list + prev/next. |
| `app/components/QuestionNavigator.tsx` | Pure UI: numbered button grid + submit-section button. |
| `app/components/ResultsScreen.tsx` | Pure UI: score box, breakdown, review toggle, new-test button. |
| `app/components/ReviewItem.tsx` | Pure UI: one reviewed question with badge + explanation (HTML rendering of trusted seed content). |
| `app/dashboard/page.tsx` | Server component placeholder + one-time Supabase smoke test. Removed in Auth sub-project. |
| `app/providers.tsx` | Client-side `<QueryClientProvider>` wrapper. |
| `app/lib/supabase/client.ts` | Browser-side Supabase client factory via `createBrowserClient`. |
| `app/lib/supabase/server.ts` | Server-side Supabase client factory via `createServerClient` + `next/headers`. |
| `supabase/migrations/20260521000000_sat_schema.sql` | Creates `sat` schema with deny-by-default RLS posture. |

---

## Chunk 1: Baseline commit, pnpm switch, Next.js 15 bump

This chunk gets the working tree into a known-good state under the new package manager and framework version, with the original JS app unchanged. Three commits total. After Chunk 1, every gameplay behavior is identical to today — only the build infrastructure has moved.

### Task 1: Commit the JS baseline and tag `pre-ts-migration`

**Files:**
- Modify: `.gitignore` (append `supabase/.temp/`)
- New commit: stages all existing untracked source files
- New tag: `pre-ts-migration`

**Why this task exists:** The repo currently has one commit (the spec). The working tree contains the original JS app as untracked files. We need them committed before any migration begins so the spec's `pre-ts-migration → post-foundation` diff is reviewable end-to-end.

- [ ] **Step 1.1:** Verify the repo state before touching anything.

  ```powershell
  git status --short
  git log --oneline
  ```
  Expected: status shows untracked `app/`, `.gitignore`, `README.md`, `package.json`, `next.config.js`, `jsconfig.json`. `CLAUDE.md`, the spec at `docs/superpowers/specs/...`, and this plan at `docs/superpowers/plans/...` should NOT appear in status because they were all committed during the plan-writing session before Task 1 starts. Log shows commits ending with the plan commit. If status shows anything modified or staged unexpectedly, stop and surface to operator.

- [ ] **Step 1.2:** Append `supabase/.temp/` to `.gitignore`.

  Open `.gitignore`. After the `# vercel` block (or anywhere after the existing entries), add a new section:
  ```
  # supabase
  supabase/.temp/
  ```
  Save. Run `cat .gitignore | tail -5` (PowerShell: `Get-Content .gitignore -Tail 5`) and confirm the new lines are present.

- [ ] **Step 1.3:** Verify `.gitignore` already covers the things the baseline commit must not include.

  PowerShell:
  ```powershell
  foreach ($p in 'node_modules', '.env.local', '.next', 'supabase/.temp') {
    $result = git check-ignore -v $p
    if ($LASTEXITCODE -ne 0) { Write-Host "MISSING: $p" -ForegroundColor Red }
    else { Write-Host $result }
  }
  ```
  Bash equivalent:
  ```bash
  for p in node_modules .env.local .next supabase/.temp; do
    git check-ignore -v "$p" || echo "MISSING: $p"
  done
  ```
  Expected: each path prints `.gitignore:<line>:<pattern> <queried-path>` (a hit), not "MISSING". If anything prints MISSING, edit `.gitignore` to cover that path before continuing.

- [ ] **Step 1.4:** Stage every existing baseline file explicitly (avoid `git add -A` so a stray `.env.local` never sneaks in even if `.gitignore` is wrong).

  ```powershell
  git add .gitignore README.md package.json next.config.js jsconfig.json
  git add app/
  git status --short
  ```
  Expected: status shows `A` for `.gitignore`, `README.md`, `package.json`, `next.config.js`, `jsconfig.json`, `app/SatPractice.jsx`, `app/SatPractice.module.css`, `app/page.js`, `app/page.module.css`, `app/layout.js`, `app/globals.css`, `app/questions.js`, `app/favicon.ico`, `app/fonts/GeistMonoVF.woff`, `app/fonts/GeistVF.woff`. No `??` entries should remain. No `M` entries should exist. (The plan and spec under `docs/` are already tracked from prior commits — they don't appear here.)

  If `node_modules/`, `.env*.local`, or `package-lock.json` appears in status — STOP. `.gitignore` is wrong; do not commit until corrected.

- [ ] **Step 1.5:** Commit the baseline.

  PowerShell (preferred — uses a here-string for the multi-line message):
  ```powershell
  git commit -m @'
chore: commit pre-migration JS baseline

Baseline of the existing Next.js 14 + plain-JS SAT practice app
before Foundation sub-project migration begins. Tagged
pre-ts-migration so the final post-foundation diff is reviewable
end-to-end. (Spec and plan were committed earlier; this commit
is just the JS source baseline.)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```
  Note: the closing `'@` MUST be at column 0 (no leading whitespace) — PowerShell will parse-error otherwise.

  Bash equivalent:
  ```bash
  git commit -m "$(cat <<'EOF'
chore: commit pre-migration JS baseline

Baseline of the existing Next.js 14 + plain-JS SAT practice app
before Foundation sub-project migration begins. Tagged
pre-ts-migration so the final post-foundation diff is reviewable
end-to-end. (Spec and plan were committed earlier; this commit
is just the JS source baseline.)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
  ```
  Expected: commit succeeds, `git log --oneline` now shows four commits.

- [ ] **Step 1.6:** Tag the baseline.

  ```bash
  git tag pre-ts-migration
  git tag --list
  ```
  Expected output includes `pre-ts-migration`.

- [ ] **Step 1.7:** Verification — the app still runs unchanged.

  ```powershell
  npm install
  npm run dev
  ```
  Open http://localhost:3000 in a browser. Verify:
  - Start screen loads with the SAT Practice Test heading.
  - Entering a name and clicking Start transitions to the test screen with a section header and timer.
  - Picking an answer and clicking Next advances.
  - Submitting a section moves to the next section or to the results screen.
  - Results screen shows a scaled score and "Show full review" button reveals questions with bold explanations.

  Stop the dev server (Ctrl+C). npm will have generated `node_modules/` (gitignored) and possibly `package-lock.json` (NOT gitignored). Task 2 cleans both up before switching to pnpm — do NOT add `package-lock.json` to `.gitignore` (it's a normal lockfile that shouldn't drift into the repo, but adding it to `.gitignore` could hide accidental commits). Just leave it untracked until Task 2 deletes it.

### Task 2: Switch package manager from npm to pnpm

**Files:**
- Modify: `package.json` (add `packageManager` field)
- Create: `pnpm-lock.yaml` (generated by `pnpm install`)
- Delete: `package-lock.json` (if present from Task 1 verification)

**Why this task exists:** The OneReal stack (Decision D1) uses pnpm. The current `package.json` has no `packageManager` field. We make the switch before bumping Next.js so the version bump uses pnpm's resolver from the start.

- [ ] **Step 2.1:** Confirm pnpm is installed and pick a version to pin.

  ```bash
  pnpm --version
  ```
  Expected: a version number prints (anything ≥ 9.0 is fine). If `pnpm` is not found, install it:
  ```bash
  npm install -g pnpm@latest
  pnpm --version
  ```

- [ ] **Step 2.2:** Edit `package.json` to add the `packageManager` field.

  Open `package.json`. After the `"private": true,` line, add:
  ```json
    "packageManager": "pnpm@<version-from-step-2.1>",
  ```
  Example if pnpm 9.12.0 is installed:
  ```json
  {
    "name": "sat-app",
    "version": "0.1.0",
    "private": true,
    "packageManager": "pnpm@9.12.0",
    "scripts": {
  ```
  Save.

- [ ] **Step 2.3:** Delete any npm-generated lockfile or modules left from Task 1.

  PowerShell:
  ```powershell
  Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
  ```
  Bash equivalent: `rm -rf node_modules package-lock.json`

- [ ] **Step 2.4:** Install dependencies with pnpm.

  ```bash
  pnpm install
  ```
  Expected: install completes, `pnpm-lock.yaml` is created in `sat-app/`, `node_modules/` is recreated. No errors. Warnings about peer deps are acceptable as long as the install exits 0.

- [ ] **Step 2.5:** Verify the app still runs on pnpm.

  ```bash
  pnpm dev
  ```
  Open http://localhost:3000. Click through one complete Quick test — start → test → results → review. Stop the dev server.

- [ ] **Step 2.6:** Stage and commit.

  ```powershell
  git add package.json pnpm-lock.yaml
  git status --short
  ```
  Expected: status shows `M package.json` and `A pnpm-lock.yaml` and nothing else. (`node_modules/` should not appear — it's gitignored.)

  PowerShell commit:
  ```powershell
  git commit -m @'
chore: switch package manager from npm to pnpm

Pin pnpm version via packageManager field in package.json.
Generate pnpm-lock.yaml from current dependency set; gameplay
behavior unchanged from pre-ts-migration tag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```
  Bash equivalent uses the `"$(cat <<'EOF' ... EOF)"` pattern shown in Step 1.5.

### Task 3: Bump Next.js 14 → 15 (and React 18 → 19)

**Files:**
- Modify: `package.json` (bump `next`, `react`, `react-dom` — and add `@types/react`/`@types/react-dom` if any are present; the current `package.json` has neither, so they get installed fresh in Task 4)
- Modify: `pnpm-lock.yaml` (regenerated by `pnpm install`)

**Why this task exists:** The OneReal stack runs Next.js 15 + React 19. Next 15 broadened its peer range to admit React 19 alongside React 18.2+, so a `pnpm install` with React 18 would technically still resolve — we adopt React 19 here as a deliberate alignment with the OneReal stack (Decision D1), not because Next 15 forces it. We bump in isolation so any regression has a single-commit blast radius and is easy to bisect. Next 15's App Router changes (notably async `cookies()`/`headers()`) don't affect the existing JS app since it doesn't use them — they'll matter in Task 8 when `app/lib/supabase/server.ts` is added, which is why we land the framework versions first.

- [ ] **Step 3.1:** Identify the current next/react versions.

  PowerShell:
  ```powershell
  Select-String -Path package.json -Pattern '"next"|"react"|"react-dom"'
  ```
  Bash equivalent: `grep -E '"next"|"react"|"react-dom"' package.json`

  Expected: three matches — `"next": "14.2.35"`, `"react": "^18"`, `"react-dom": "^18"` (the exact 14.x patch may vary).

- [ ] **Step 3.2:** Bump versions in `package.json`.

  Open `package.json`. Change the three dependency entries (preserve the surrounding JSON structure):
  ```json
      "next": "15.0.3",
      "react": "^19.0.0",
      "react-dom": "^19.0.0"
  ```
  Note the concrete `15.0.3` pin for `next` (reproducible across re-runs); React/React-DOM use a caret so pnpm picks the latest 19.x. Save.

  **Why concrete pin for Next, caret for React?** Next.js's minor releases occasionally introduce regressions in App Router internals; pinning the exact version lets us bisect a future framework upgrade as its own commit. React 19 is more stable across patch versions for our usage.

- [ ] **Step 3.3:** Install.

  ```powershell
  pnpm install
  ```
  Expected: install succeeds with no `ERR_PNPM_PEER_DEP_ISSUES`; `pnpm-lock.yaml` is updated. If pnpm reports a peer-dependency error involving `react@^19` (e.g., a transitive dep still wants React 18), pause and surface to operator — for Foundation's surface (no transitive React-aware libs yet) this should not happen.

- [ ] **Step 3.4:** Run the dev server and watch for breaking-change output.

  ```powershell
  pnpm dev
  ```
  Expected: dev server boots on http://localhost:3000. Watch the terminal for any line starting with `Warning:` or `Error:`. The current app uses no `cookies()`/`headers()` calls and no `next/font` patterns that changed. React 19 may print a one-time deprecation about `ReactDOM.render` or `forwardRef` semantics, but the current app uses neither — a clean boot is expected.

  Things to watch for specifically that DO appear in this codebase:
  - React 19 has stricter handling of `useEffect` deps. `SatPractice.jsx` contains `// eslint-disable-next-line react-hooks/exhaustive-deps` on the timer effect — this disable is intentional and load-bearing (see the strict-mode/timer risk row in spec Section 8). If React 19 dev-mode warns about it loudly, accept the warning. **Do not "fix" the deps by adding `handleTimeUp` to them — that breaks timer behavior.**
  - The `dangerouslySetInnerHTML` in `SatPractice.jsx` is fine on React 19 and continues to render the `<b>` tags in explanations.

- [ ] **Step 3.5:** Full manual gameplay check on Next 15 + React 19.

  In a browser at http://localhost:3000:
  - Start screen renders.
  - Enter name "Test Student" → click Start → test screen.
  - Verify timer starts (`MM:SS` format) and counts down.
  - Verify section header "Reading & Writing" or "Math" displays based on `SECTION_ORDER`.
  - Click answer for Q1 → click Next → Q2 visible.
  - Use the navigator grid to jump to Q5 → grid highlights it.
  - Click "Submit section" → confirmation dialog → confirm → next section or results.
  - On results screen: verify scaled score in 400–1600 range.
  - Click "Show full review" → review items render with green/red badges and bold-formatted explanations.
  - Click "Start a New Test" → returns to start screen with state reset.

  If any of the above fails or throws a runtime error in the browser console, stop and surface to operator — the framework/React bump may have introduced a regression in a code path not currently expected.

  Stop the dev server.

- [ ] **Step 3.6:** Commit.

  ```powershell
  git add package.json pnpm-lock.yaml
  git status --short
  ```
  Expected: only `M package.json` and `M pnpm-lock.yaml`.

  PowerShell commit:
  ```powershell
  git commit -m @'
chore: bump Next.js 14 -> 15 and React 18 -> 19

Framework bump. React 19 is forced by Next 15's peer-dep requirement.
App uses no APIs that changed in either upgrade; manual gameplay
click-through unchanged from baseline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```

**Chunk 1 exit criteria:** `git log --oneline` shows the spec commits plus three new commits (baseline, pnpm, Next 15+React 19). Tag `pre-ts-migration` exists. The app runs identically to today on the upgraded toolchain.

---

## Chunk 2: Task 4 part A — TypeScript setup + pure logic + state hook

**Important atomicity note:** Spec Section 5 Step 4 requires that the entire TypeScript migration + component decomposition land as **one atomic commit** (sub-steps 4.1 through 4.9). The actual commit happens at the end of **Chunk 3** (the components chunk). Chunk 2 stages everything covered here, but does **not commit**. Treat Chunk 2 → Chunk 3 as one continuous Task 4.

In this chunk: tsconfig + TS deps install, `next.config.ts`, `app/layout.tsx`, the typed `questions.ts`, the pure-logic `lib/test.ts`, and the `useTestSession` hook. After Chunk 2 the app does **not yet run** (the JSX still imports `./SatPractice` which no longer matches the partly-rewritten state) — that's expected; Chunk 3 lands the components and brings the app back online before committing.

### Task 4: Add TypeScript and decompose `SatPractice.jsx` (one atomic commit)

**Files (Chunk 2 portion):**
- Create: `tsconfig.json`
- Modify: `package.json` (add TS + types dev deps)
- Create: `next.config.ts`
- Delete: `next.config.js`
- Create: `app/layout.tsx`
- Delete: `app/layout.js`
- Create: `app/lib/questions.ts`
- Delete: `app/questions.js`
- Create: `app/lib/test.ts`
- Create: `app/hooks/useTestSession.ts`

- [ ] **Step 4.1:** Install TypeScript dev dependencies.

  ```powershell
  pnpm add -D typescript @types/react @types/react-dom @types/node
  ```
  Expected: install succeeds; `package.json` gains a `devDependencies` block with the four packages; `pnpm-lock.yaml` is updated.

- [ ] **Step 4.2:** Create `tsconfig.json` at the repo root.

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["dom", "dom.iterable", "esnext"],
      "allowJs": false,
      "skipLibCheck": true,
      "strict": true,
      "noEmit": true,
      "esModuleInterop": true,
      "module": "esnext",
      "moduleResolution": "bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "preserve",
      "incremental": true,
      "plugins": [{ "name": "next" }],
      "paths": {
        "@/*": ["./*"]
      }
    },
    "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    "exclude": ["node_modules"]
  }
  ```
  Save. Delete `jsconfig.json` (its only function — the `@/*` path alias — is now in `tsconfig.json`):
  ```powershell
  Remove-Item jsconfig.json
  ```

- [ ] **Step 4.3:** Add a `type-check` script to `package.json`.

  Open `package.json`. Inside the `scripts` block, add a `type-check` entry. Final scripts block:
  ```json
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "next lint",
      "type-check": "tsc --noEmit"
    },
  ```
  Save.

- [ ] **Step 4.4:** Rename `next.config.js` → `next.config.ts` and convert syntax.

  Delete `next.config.js`:
  ```powershell
  Remove-Item next.config.js
  ```
  Create `next.config.ts`:
  ```ts
  import type { NextConfig } from 'next';

  const nextConfig: NextConfig = {};

  export default nextConfig;
  ```

- [ ] **Step 4.5:** Convert `app/layout.js` → `app/layout.tsx`.

  Delete `app/layout.js`:
  ```powershell
  Remove-Item app/layout.js
  ```
  Create `app/layout.tsx` (the body is identical to the old layout — only file extension and type annotations change):
  ```tsx
  import type { Metadata, ReactNode } from 'react';
  import './globals.css';

  export const metadata: Metadata = {
    title: 'SAT Practice Test',
    description: 'A timed, replayable SAT-style practice test with instant scoring and explanations.',
  };

  export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }
  ```
  (`ReactNode` import comes from `react`, not `next`. The `Metadata` type is the Next 15 typed metadata export.)

- [ ] **Step 4.6:** Create `app/lib/questions.ts` from `app/questions.js`.

  Create the new file path:
  ```powershell
  New-Item -ItemType Directory -Force app/lib | Out-Null
  ```

  Create `app/lib/questions.ts` with the typed shape:
  ```ts
  // SAT seed question bank. Each entry's `id` is immutable once committed:
  // see Foundation spec Section 5 Step 4 sub-step 3 for the ordering rule.
  export interface Question {
    id: string;                  // `seed-rw-NNN` or `seed-math-NNN`, 1-indexed by order in this file
    section: 'rw' | 'math';
    skill: string;
    passage?: string;
    prompt: string;
    choices: string[];
    answerIndex: number;         // index into `choices` (renamed from the old `answer`)
    explanation: string;         // may contain inline HTML (<b>, <i>) — trusted seed content
    source: 'seed' | 'ai';       // every Foundation entry is 'seed'
  }

  export const BANK: Question[] = [
    /* ---------- READING & WRITING (17 entries) ---------- */
    {
      id: 'seed-rw-001',
      section: 'rw',
      skill: 'Words in Context',
      passage: `Marie Curie's discovery of radium was not the product of a single flash of insight. Rather, it emerged from years of ______ labor, as she processed tons of pitchblende ore in a leaky shed to isolate mere fractions of a gram.`,
      prompt: 'Which word best completes the text?',
      choices: ['painstaking', 'effortless', 'reckless', 'momentary'],
      answerIndex: 0,
      explanation: 'The passage stresses "years of...labor" and processing "tons" of ore for tiny amounts — that describes <b>painstaking</b> (careful, laborious) work. "Effortless" and "momentary" contradict the years of toil; "reckless" misreads her careful method.',
      source: 'seed',
    },
    // ... continue with seed-rw-002 through seed-rw-017, then seed-math-001 through seed-math-017.
    // Apply this mechanical transform to every entry in the old app/questions.js BANK:
    //   1. Add `id: 'seed-rw-NNN'` (RW entries) or `id: 'seed-math-NNN'` (Math entries), three-digit zero-padded,
    //      numbered 001..017 in the order they appear in app/questions.js (RW block first, then Math block).
    //   2. Rename the field `answer` -> `answerIndex`. Value unchanged.
    //   3. Add `source: 'seed'` to every entry.
    //   4. Keep `section`, `skill`, `passage` (where present), `prompt`, `choices`, `explanation` unchanged.
  ];

  export const SECTION_CONFIG = {
    rw: { name: 'Reading & Writing', shortCount: 10, secsPerQ: 90 },
    math: { name: 'Math', shortCount: 10, secsPerQ: 105 },
  } as const;

  export const SECTION_ORDER = ['rw', 'math'] as const;
  export type SectionKey = (typeof SECTION_ORDER)[number];
  ```

  Then **literally translate the 34 entries** from `app/questions.js` into the `BANK` array using the mechanical transform documented in the comment. For verification, the final RW entry should be `id: 'seed-rw-017'` and the final Math entry `id: 'seed-math-017'`. The translation is mechanical enough that a single LLM pass over `app/questions.js` (or a subagent dispatched for the rewrite) produces a correct `app/lib/questions.ts` — verify the result with Step 4.7's count and uniqueness checks.

  Delete the old file:
  ```powershell
  Remove-Item app/questions.js
  ```

- [ ] **Step 4.7:** Self-check the BANK transform.

  Open `app/lib/questions.ts`. Visual scan to confirm:
  - `BANK.length` is 34 once typed.
  - Every entry has `id`, `section`, `skill`, `prompt`, `choices`, `answerIndex`, `explanation`, `source`.
  - No entry uses the old `answer:` key.
  - RW ids run `seed-rw-001` through `seed-rw-017`. Math ids run `seed-math-001` through `seed-math-017`.
  - No duplicate ids.

  Mechanical checks via PowerShell:
  ```powershell
  # Total count of seed ids
  Select-String -Path app/lib/questions.ts -Pattern "id: 'seed-" | Measure-Object | Select-Object -ExpandProperty Count

  # Uniqueness check
  (Select-String -Path app/lib/questions.ts -Pattern "id: 'seed-[a-z]+-\d{3}'" |
    ForEach-Object { $_.Matches.Value } |
    Sort-Object -Unique).Count
  ```
  Expected: both commands print `34`. If the second number is less than the first, a duplicate id was introduced — find and fix before continuing.

- [ ] **Step 4.8:** Create `app/lib/test.ts` — the pure logic module.

  ```ts
  import type { Question, SectionKey } from './questions';
  import { BANK as DEFAULT_BANK, SECTION_CONFIG, SECTION_ORDER } from './questions';

  export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

  export interface TestSection {
    key: SectionKey;
    name: string;
    questions: Question[];   // already shuffled; choice order already shuffled per-question
    timeLimit: number;       // seconds
  }

  export interface Test {
    name: string;
    sections: TestSection[];
  }

  export interface Results {
    perSection: { name: string; correct: number; total: number }[];
    pct: number;
    scaled: number;          // 400..1600, rounded to nearest 10
  }

  export type TestLength = 'short' | 'full';

  export function shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Shuffles a question's `choices` and rewrites `answerIndex` to point to the new position.
  export function shuffleChoices(q: Question): Question {
    const idxs = shuffle(q.choices.map((_, i) => i));
    return {
      ...q,
      choices: idxs.map((i) => q.choices[i]),
      answerIndex: idxs.indexOf(q.answerIndex),
    };
  }

  export function buildTest(
    name: string,
    testLength: TestLength,
    bank: Question[] = DEFAULT_BANK,
  ): Test {
    const sections: TestSection[] = SECTION_ORDER.map((secKey) => {
      const cfg = SECTION_CONFIG[secKey];
      const pool = shuffle(bank.filter((q) => q.section === secKey));
      const count = testLength === 'short' ? Math.min(cfg.shortCount, pool.length) : pool.length;
      const questions = pool.slice(0, count).map(shuffleChoices);
      return {
        key: secKey,
        name: cfg.name,
        questions,
        timeLimit: count * cfg.secsPerQ,
      };
    });
    return { name: name || 'Student', sections };
  }

  export function computeResults(
    test: Test,
    responses: (number | null)[][],
  ): Results {
    let totalCorrect = 0;
    let totalQ = 0;
    const perSection = test.sections.map((sec, si) => {
      let correct = 0;
      sec.questions.forEach((q, qi) => {
        if (responses[si][qi] === q.answerIndex) correct++;
      });
      totalCorrect += correct;
      totalQ += sec.questions.length;
      return { name: sec.name, correct, total: sec.questions.length };
    });
    const pct = totalQ ? totalCorrect / totalQ : 0;
    const scaled = Math.round((400 + pct * 1200) / 10) * 10;
    return { perSection, pct, scaled };
  }

  export function fmtTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  ```

  Key differences from the original `SatPractice.jsx` helpers:
  - `shuffleChoices` now returns a full `Question` (not just `{choices, answerIndex}`) so callers don't have to splat the result.
  - `buildTest` takes `bank` as a parameter with `DEFAULT_BANK` as the default — this is the seam the AI sub-project plugs into (sub-project #2).
  - `computeResults` uses `q.answerIndex` (renamed from `q.answer`).
  - Scaled-score formula preserved verbatim: `Math.round((400 + pct * 1200) / 10) * 10`.

- [ ] **Step 4.9:** Create `app/hooks/useTestSession.ts`.

  ```powershell
  New-Item -ItemType Directory -Force app/hooks | Out-Null
  ```

  Create `app/hooks/useTestSession.ts`:
  ```ts
  'use client';

  import { useState, useRef, useEffect, useCallback } from 'react';
  import {
    buildTest,
    computeResults,
    type Results,
    type Test,
    type TestLength,
  } from '@/app/lib/test';

  export type Screen = 'start' | 'test' | 'results';

  export interface TestSession {
    // state
    screen: Screen;
    name: string;
    setName: (s: string) => void;
    testLength: TestLength;
    setTestLength: (l: TestLength) => void;
    test: Test | null;
    secIdx: number;
    qIdx: number;
    responses: (number | null)[][];
    remaining: number[];
    showReview: boolean;
    toggleReview: () => void;
    // actions
    start: () => void;
    selectChoice: (i: number) => void;
    goToQuestion: (qi: number) => void;
    submitSection: () => void;
    newTest: () => void;
    results: Results | null;
  }

  export function useTestSession(): TestSession {
    const [screen, setScreen] = useState<Screen>('start');
    const [name, setName] = useState('');
    const [testLength, setTestLength] = useState<TestLength>('short');

    const [test, setTest] = useState<Test | null>(null);
    const [secIdx, setSecIdx] = useState(0);
    const [qIdx, setQIdx] = useState(0);
    const [responses, setResponses] = useState<(number | null)[][]>([]);
    const [remaining, setRemaining] = useState<number[]>([]);
    const [showReview, setShowReview] = useState(false);

    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopTimer = useCallback(() => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }, []);

    // Cleanup on unmount.
    useEffect(() => () => stopTimer(), [stopTimer]);

    // Drive the countdown whenever we're on the test screen / change section.
    useEffect(() => {
      if (screen !== 'test') return;
      stopTimer();
      tickRef.current = setInterval(() => {
        setRemaining((prev) => {
          const next = prev.slice();
          if (next[secIdx] > 0) next[secIdx] -= 1;
          if (next[secIdx] <= 0) {
            // Defer the advance to avoid setState mid-render of the parent tree.
            setTimeout(() => handleTimeUp(), 0);
          }
          return next;
        });
      }, 1000);
      return stopTimer;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screen, secIdx]);

    const handleTimeUp = () => {
      stopTimer();
      if (!test) return;
      if (secIdx < test.sections.length - 1) {
        window.alert('Time is up for this section. Moving to the next section.');
        setSecIdx((s) => s + 1);
        setQIdx(0);
      } else {
        window.alert('Time is up. Submitting your test.');
        finish();
      }
    };

    const finish = () => {
      stopTimer();
      setScreen('results');
    };

    const start = () => {
      const trimmed = name.trim();
      if (!trimmed) {
        window.alert('Please enter a name to start.');
        return;
      }
      const t = buildTest(trimmed, testLength);
      setTest(t);
      setResponses(t.sections.map((s) => new Array(s.questions.length).fill(null)));
      setRemaining(t.sections.map((s) => s.timeLimit));
      setSecIdx(0);
      setQIdx(0);
      setShowReview(false);
      setScreen('test');
    };

    const selectChoice = (i: number) => {
      setResponses((prev) => {
        const next = prev.map((arr) => arr.slice());
        next[secIdx][qIdx] = i;
        return next;
      });
    };

    const goToQuestion = (qi: number) => setQIdx(qi);

    const submitSection = () => {
      if (!test) return;
      const unanswered = responses[secIdx].filter((r) => r === null).length;
      const last = secIdx === test.sections.length - 1;
      let msg = unanswered > 0 ? `You have ${unanswered} unanswered question(s) in this section. ` : '';
      msg += last ? 'Submit the whole test now?' : 'Move on to the next section now?';
      if (!window.confirm(msg)) return;
      if (last) {
        finish();
      } else {
        setSecIdx((s) => s + 1);
        setQIdx(0);
      }
    };

    const newTest = () => {
      stopTimer();
      setScreen('start');
    };

    const toggleReview = () => setShowReview((v) => !v);

    const results = screen === 'results' && test ? computeResults(test, responses) : null;

    return {
      screen, name, setName, testLength, setTestLength,
      test, secIdx, qIdx, responses, remaining,
      showReview, toggleReview,
      start, selectChoice, goToQuestion, submitSection, newTest, results,
    };
  }
  ```

  **Critical preservation notes:**
  - The `setTimeout(handleTimeUp, 0)` defer is load-bearing — do not "simplify" it.
  - The `useEffect` deps `[screen, secIdx]` and the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment are intentional — preserve verbatim.
  - `start()` validates the trimmed name with `window.alert` (matching the original UX); replacing this with inline error rendering is out of scope.
  - The `if (!test) return;` guard in `handleTimeUp` and `submitSection` is a **TypeScript-strictness addition**, not a behavioral change — `test: Test | null` requires it to access `test.sections`. In the original JS, `test` was guaranteed non-null at those call sites by control flow; the guard preserves identical runtime behavior while satisfying strict null checks.
  - If `pnpm lint` later flags "use before define" on `handleTimeUp` inside the `useEffect`, the documented fix is to add `// eslint-disable-next-line @typescript-eslint/no-use-before-define` above the `setTimeout` line. Do not hoist `handleTimeUp` above the effect — the original ordering is the proven structure.
  - The runtime per-question object now carries `id`, `section`, and `source` (it's a full `Question`, not the bare `{skill, passage, prompt, explanation, choices, answer}` the original constructed). This is additive and harmless; components in Chunk 3 should not rely on the absence of those fields.

- [ ] **Step 4.10:** Type-check what's been written so far.

  ```powershell
  pnpm type-check
  ```
  Expected: `tsc --noEmit` reports **zero errors**. The still-existing `app/SatPractice.jsx` and `app/page.js` are NOT checked because the new `tsconfig.json` sets `"allowJs": false` and the `include` array only lists `.ts`/`.tsx` files. If you see any errors at all, they come from the new TS files — fix before continuing, Chunk 3 builds on them.

  Don't be surprised that broken `.jsx`/`.js` files (which still import the deleted `./questions`) produce no type-check output here. They'll fail at `pnpm build` if attempted, but `pnpm build` is deliberately not run at this exit point — the app is mid-rewrite and the build is expected to be broken until Chunk 3's last step.

**Chunk 2 exit state:** New TS files (`tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/lib/questions.ts`, `app/lib/test.ts`, `app/hooks/useTestSession.ts`) exist on disk. Old files (`jsconfig.json`, `next.config.js`, `app/layout.js`, `app/questions.js`) are deleted. **Nothing is committed.** `app/SatPractice.jsx` and `app/page.js` still exist but are now broken (they import the deleted `./questions`). The app does not boot. This is expected — Chunk 3 finishes Task 4 by adding the components and committing.

---

## Chunk 3: Task 4 part B — Components, top-level router, atomic commit

This chunk finishes Task 4. It creates the seven presentational components plus the thin `SatPractice.tsx` router, swaps `page.js` for `page.tsx`, deletes the old `SatPractice.jsx`, verifies the app runs again, and **commits the entire Task 4 work as one atomic commit**. CSS-module references (`styles.btnPrimary`, etc.) are kept as-is — the Tailwind/shadcn cutover is Task 6 (Chunk 4).

**Convention for all components:** every component file starts with `'use client';`, imports `styles from '@/app/SatPractice.module.css'` for the existing class names, and is a pure function component with explicit prop types. No internal `useState` — all state flows from `useTestSession`.

### Task 4 (continued)

**Files (Chunk 3 portion):**
- Create: `app/components/SatPractice.tsx`
- Create: `app/components/StartScreen.tsx`
- Create: `app/components/TestScreen.tsx`
- Create: `app/components/TopBar.tsx`
- Create: `app/components/QuestionView.tsx`
- Create: `app/components/QuestionNavigator.tsx`
- Create: `app/components/ResultsScreen.tsx`
- Create: `app/components/ReviewItem.tsx`
- Create: `app/page.tsx`
- Delete: `app/page.js`
- Delete: `app/SatPractice.jsx`

- [ ] **Step 4.11:** Create `app/components/StartScreen.tsx`.

  ```powershell
  New-Item -ItemType Directory -Force app/components | Out-Null
  ```

  ```tsx
  'use client';

  import type { TestLength } from '@/app/lib/test';
  import styles from '@/app/SatPractice.module.css';

  interface StartScreenProps {
    name: string;
    setName: (s: string) => void;
    testLength: TestLength;
    setTestLength: (l: TestLength) => void;
    onStart: () => void;
  }

  export function StartScreen({ name, setName, testLength, setTestLength, onStart }: StartScreenProps) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <span className={styles.pill}>Digital SAT · Practice</span>
          <h1 className={styles.h1}>SAT Practice Test</h1>
          <p className={styles.lead}>
            A full timed practice run with Reading &amp; Writing and Math sections. Answer the questions,
            submit, and get an instant score with a worked explanation for every problem. Each new test
            pulls fresh, randomized questions.
          </p>

          <label className={styles.field} htmlFor="student-name">Student name</label>
          <input
            id="student-name"
            className={styles.input}
            type="text"
            value={name}
            placeholder="Type your name to begin"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onStart()}
          />

          <label className={styles.field}>Test length</label>
          <div className={styles.btnRow} style={{ marginBottom: 18 }}>
            <button
              className={`${styles.btnGhost} ${testLength === 'short' ? styles.selectedOpt : ''}`}
              onClick={() => setTestLength('short')}
            >
              Quick (10 + 10, ~25 min)
            </button>
            <button
              className={`${styles.btnGhost} ${testLength === 'full' ? styles.selectedOpt : ''}`}
              onClick={() => setTestLength('full')}
            >
              Full sections (all questions)
            </button>
          </div>

          <div className={styles.btnRow}>
            <button className={styles.btnPrimary} onClick={onStart}>Start Test</button>
          </div>
          <p className={styles.note}>
            Tip: the timer counts down per section, just like the real SAT. When time runs out, the
            section auto-advances.
          </p>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4.12:** Create `app/components/TopBar.tsx`.

  ```tsx
  'use client';

  import { fmtTime } from '@/app/lib/test';
  import styles from '@/app/SatPractice.module.css';

  interface TopBarProps {
    secIdx: number;
    qIdx: number;
    totalQ: number;
    studentName: string;
    remaining: number;          // seconds left in the current section
  }

  export function TopBar({ secIdx, qIdx, totalQ, studentName, remaining }: TopBarProps) {
    const timerClass = `${styles.timer} ${
      remaining <= 30 ? styles.danger : remaining <= 120 ? styles.warn : ''
    }`;
    return (
      <div className={styles.topbar}>
        <div className={styles.seg}>
          Section <b>{secIdx + 1}</b> · Question <b>{qIdx + 1}</b>/<b>{totalQ}</b>
        </div>
        <div className={timerClass}>{fmtTime(Math.max(0, remaining))}</div>
        <div className={styles.seg}>{studentName}</div>
      </div>
    );
  }
  ```

- [ ] **Step 4.13:** Create `app/components/QuestionView.tsx`.

  ```tsx
  'use client';

  import { LETTERS } from '@/app/lib/test';
  import type { Question } from '@/app/lib/questions';
  import styles from '@/app/SatPractice.module.css';

  interface QuestionViewProps {
    section: { name: string };
    question: Question;
    selected: number | null;
    onSelect: (i: number) => void;
    onPrev: () => void;
    onNext: () => void;
    isFirst: boolean;
    isLast: boolean;
  }

  export function QuestionView({
    section,
    question,
    selected,
    onSelect,
    onPrev,
    onNext,
    isFirst,
    isLast,
  }: QuestionViewProps) {
    return (
      <div className={styles.card}>
        <div className={styles.qMeta}>{section.name} · {question.skill}</div>
        {question.passage && <div className={styles.passage}>{question.passage}</div>}
        <div className={styles.prompt}>{question.prompt}</div>
        <div className={styles.choices}>
          {question.choices.map((c, i) => (
            <div
              key={i}
              className={`${styles.choice} ${selected === i ? styles.selected : ''}`}
              onClick={() => onSelect(i)}
            >
              <span className={styles.ltr}>{LETTERS[i]}</span>
              <span>{c}</span>
            </div>
          ))}
        </div>

        <div className={styles.btnRow} style={{ marginTop: 22, justifyContent: 'space-between' }}>
          <button
            className={styles.btnGhost}
            style={{ visibility: isFirst ? 'hidden' : 'visible' }}
            onClick={onPrev}
          >
            ‹ Previous
          </button>
          <button
            className={styles.btnPrimary}
            onClick={onNext}
            disabled={isLast}
          >
            {isLast ? 'Last question' : 'Next ›'}
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4.14:** Create `app/components/QuestionNavigator.tsx`.

  ```tsx
  'use client';

  import type { TestSection } from '@/app/lib/test';
  import styles from '@/app/SatPractice.module.css';

  interface QuestionNavigatorProps {
    section: TestSection;
    qIdx: number;
    sectionResponses: (number | null)[];
    onGoToQuestion: (qi: number) => void;
    onSubmitSection: () => void;
    isLastSection: boolean;
  }

  export function QuestionNavigator({
    section,
    qIdx,
    sectionResponses,
    onGoToQuestion,
    onSubmitSection,
    isLastSection,
  }: QuestionNavigatorProps) {
    return (
      <div className={styles.card} style={{ marginTop: 16 }}>
        <h2 className={styles.h2}>Question navigator</h2>
        <div className={styles.navgrid}>
          {section.questions.map((_, i) => (
            <button
              key={i}
              className={`${styles.navbtn} ${
                sectionResponses[i] !== null ? styles.answered : ''
              } ${i === qIdx ? styles.current : ''}`}
              onClick={() => onGoToQuestion(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className={styles.btnRow}>
          <button className={styles.btnPrimary} onClick={onSubmitSection}>
            {isLastSection ? 'Submit test' : 'Submit section'}
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4.15:** Create `app/components/TestScreen.tsx`.

  ```tsx
  'use client';

  import type { TestSection } from '@/app/lib/test';
  import { TopBar } from './TopBar';
  import { QuestionView } from './QuestionView';
  import { QuestionNavigator } from './QuestionNavigator';
  import styles from '@/app/SatPractice.module.css';

  interface TestScreenProps {
    section: TestSection;
    secIdx: number;
    totalSections: number;
    qIdx: number;
    sectionResponses: (number | null)[];
    remaining: number;
    studentName: string;
    onSelect: (i: number) => void;
    onGoToQuestion: (qi: number) => void;
    onPrev: () => void;
    onNext: () => void;
    onSubmitSection: () => void;
  }

  export function TestScreen(props: TestScreenProps) {
    const {
      section, secIdx, totalSections, qIdx, sectionResponses, remaining,
      studentName, onSelect, onGoToQuestion, onPrev, onNext, onSubmitSection,
    } = props;
    const question = section.questions[qIdx];
    const isLastSection = secIdx === totalSections - 1;
    return (
      <>
        <TopBar
          secIdx={secIdx}
          qIdx={qIdx}
          totalQ={section.questions.length}
          studentName={studentName}
          remaining={remaining}
        />
        <div className={styles.wrap}>
          <QuestionView
            section={{ name: section.name }}
            question={question}
            selected={sectionResponses[qIdx]}
            onSelect={onSelect}
            onPrev={onPrev}
            onNext={onNext}
            isFirst={qIdx === 0}
            isLast={qIdx === section.questions.length - 1}
          />
          <QuestionNavigator
            section={section}
            qIdx={qIdx}
            sectionResponses={sectionResponses}
            onGoToQuestion={onGoToQuestion}
            onSubmitSection={onSubmitSection}
            isLastSection={isLastSection}
          />
        </div>
      </>
    );
  }
  ```

- [ ] **Step 4.16:** Create `app/components/ReviewItem.tsx`.

  ```tsx
  'use client';

  import { LETTERS } from '@/app/lib/test';
  import type { Question } from '@/app/lib/questions';
  import styles from '@/app/SatPractice.module.css';

  interface ReviewItemProps {
    question: Question;
    chosenIndex: number | null;
  }

  // NOTE: explanation rendering uses dangerouslySetInnerHTML because seed BANK content
  // contains trusted <b>/<i> tags. The AI sub-project (#2) MUST replace this with a
  // sanitizer or constrained renderer once questions become user-influenced.
  export function ReviewItem({ question, chosenIndex }: ReviewItemProps) {
    const isCorrect = chosenIndex === question.answerIndex;
    return (
      <div className={styles.reviewQ}>
        <div className={styles.qMeta}>
          {question.skill}{' '}
          {chosenIndex === null ? (
            <span className={`${styles.tag} ${styles.tagSkip}`}>Skipped</span>
          ) : isCorrect ? (
            <span className={`${styles.tag} ${styles.tagOk}`}>Correct</span>
          ) : (
            <span className={`${styles.tag} ${styles.tagNo}`}>Incorrect</span>
          )}
        </div>
        {question.passage && <div className={styles.passage}>{question.passage}</div>}
        <div className={styles.prompt}>{question.prompt}</div>
        <div className={styles.ansLine}>
          Your answer:{' '}
          {chosenIndex === null ? (
            <i>none</i>
          ) : (
            <span className={isCorrect ? styles.correct : styles.wrong}>
              {LETTERS[chosenIndex]}. {question.choices[chosenIndex]}
            </span>
          )}
        </div>
        {!isCorrect && chosenIndex !== null && (
          <div className={styles.ansLine}>
            Correct answer:{' '}
            <span className={styles.correct}>
              {LETTERS[question.answerIndex]}. {question.choices[question.answerIndex]}
            </span>
          </div>
        )}
        <div className={styles.explain}>
          <b>Why:</b> <span dangerouslySetInnerHTML={{ __html: question.explanation }} />
        </div>
      </div>
    );
  }
  ```

  Note the small behavior fix vs. the original: the original renders the "Correct answer" line whenever `!isCorrect` (which fires even for skipped questions where the user didn't choose anything). The new component adds `&& chosenIndex !== null` so a Skipped row shows the explanation but doesn't redundantly render "Correct answer" — the explanation already names the right answer. **If you want strict behavior parity** with the JS original, drop the `&& chosenIndex !== null` guard.

- [ ] **Step 4.17:** Create `app/components/ResultsScreen.tsx`.

  ```tsx
  'use client';

  import type { Test, Results } from '@/app/lib/test';
  import { ReviewItem } from './ReviewItem';
  import styles from '@/app/SatPractice.module.css';

  interface ResultsScreenProps {
    test: Test;
    responses: (number | null)[][];
    results: Results;
    showReview: boolean;
    onToggleReview: () => void;
    onNewTest: () => void;
  }

  export function ResultsScreen({
    test, responses, results, showReview, onToggleReview, onNewTest,
  }: ResultsScreenProps) {
    const { perSection, pct, scaled } = results;
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <span className={styles.pill}>{test.name}</span>
          <h1 className={styles.h1}>Your results</h1>
          <div className={styles.scorebox}>
            <div className={styles.big}>{scaled}</div>
            <div className={styles.subText}>Estimated SAT score (400–1600)</div>
          </div>
          <div className={styles.bar}><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>
          <div className={styles.breakdown}>
            {perSection.map((s) => (
              <div key={s.name} className={styles.stat}>
                <div className={styles.statN}>{s.correct}/{s.total}</div>
                <div className={styles.statL}>{s.name}</div>
              </div>
            ))}
            <div className={styles.stat}>
              <div className={styles.statN}>{Math.round(pct * 100)}%</div>
              <div className={styles.statL}>Overall correct</div>
            </div>
          </div>
          <div className={styles.btnRow}>
            <button className={styles.btnPrimary} onClick={onNewTest}>Start a New Test</button>
            <button className={styles.btnGhost} onClick={onToggleReview}>
              {showReview ? 'Hide full review' : 'Show full review'}
            </button>
          </div>
          <p className={styles.note}>
            Scaled score is an approximation based on percent correct, for practice motivation only. Focus
            on the explanations below to learn from each question.
          </p>
        </div>

        {showReview && (
          <div style={{ marginTop: 18 }}>
            {test.sections.map((sec, si) => (
              <div key={si}>
                <h2 className={styles.h2} style={{ margin: '22px 0 12px' }}>
                  {sec.name} — review
                </h2>
                {sec.questions.map((q, qi) => (
                  <ReviewItem key={qi} question={q} chosenIndex={responses[si][qi]} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 4.18:** Create the thin top-level router `app/components/SatPractice.tsx`.

  ```tsx
  'use client';

  import { useTestSession } from '@/app/hooks/useTestSession';
  import { StartScreen } from './StartScreen';
  import { TestScreen } from './TestScreen';
  import { ResultsScreen } from './ResultsScreen';

  export default function SatPractice() {
    const s = useTestSession();

    if (s.screen === 'start') {
      return (
        <StartScreen
          name={s.name}
          setName={s.setName}
          testLength={s.testLength}
          setTestLength={s.setTestLength}
          onStart={s.start}
        />
      );
    }

    if (s.screen === 'test' && s.test) {
      const section = s.test.sections[s.secIdx];
      const totalSections = s.test.sections.length;
      const sectionResponses = s.responses[s.secIdx] ?? [];
      const remaining = s.remaining[s.secIdx] ?? 0;
      return (
        <TestScreen
          section={section}
          secIdx={s.secIdx}
          totalSections={totalSections}
          qIdx={s.qIdx}
          sectionResponses={sectionResponses}
          remaining={remaining}
          studentName={s.test.name}
          onSelect={s.selectChoice}
          onGoToQuestion={s.goToQuestion}
          onPrev={() => s.goToQuestion(Math.max(0, s.qIdx - 1))}
          onNext={() => s.goToQuestion(Math.min(section.questions.length - 1, s.qIdx + 1))}
          onSubmitSection={s.submitSection}
        />
      );
    }

    // screen === 'results' (or invalid mid-state; treat as nothing rendered)
    if (s.results && s.test) {
      return (
        <ResultsScreen
          test={s.test}
          responses={s.responses}
          results={s.results}
          showReview={s.showReview}
          onToggleReview={s.toggleReview}
          onNewTest={s.newTest}
        />
      );
    }

    return null;
  }
  ```

- [ ] **Step 4.19:** Convert `app/page.js` → `app/page.tsx`.

  Delete the old:
  ```powershell
  Remove-Item app/page.js
  ```
  Create `app/page.tsx`:
  ```tsx
  import SatPractice from '@/app/components/SatPractice';

  export default function Home() {
    return <SatPractice />;
  }
  ```

- [ ] **Step 4.20:** Delete the now-replaced original.

  ```powershell
  Remove-Item app/SatPractice.jsx
  ```

- [ ] **Step 4.21:** Type-check the full new tree.

  ```powershell
  pnpm type-check
  ```
  Expected: zero errors. If errors appear, fix them before committing. Common ones to expect:
  - Missing prop on a component (e.g., forgot to pass `studentName` to `TestScreen`).
  - Implicit `any` from a missing parameter type — add the explicit type.
  - `Property 'answer' does not exist on type 'Question'` — any straggling `q.answer` reference must become `q.answerIndex`.

- [ ] **Step 4.22:** Manual gameplay verification before committing.

  ```powershell
  pnpm dev
  ```
  Open http://localhost:3000. Run the full manual checklist from Task 3 Step 3.5 (start → enter name → Quick test → answer some, skip some → submit → results → show review → start new test).

  **In addition, verify the new behavior split:**
  - Question navigator buttons still highlight answered (`styles.answered`) and current (`styles.current`).
  - Timer color thresholds still fire at ≤120s warn and ≤30s danger.
  - Review screen behavior, three cases:
    - **Correct answer:** "Correct" badge, "Your answer:" line in green, no "Correct answer:" line, "Why:" explanation present.
    - **Wrong answer:** "Incorrect" badge, "Your answer:" line in red, "Correct answer:" line in green, "Why:" explanation present.
    - **Skipped:** "Skipped" badge, "Your answer: none" line, **no "Correct answer:" line** (intentional new behavior — the explanation already names the right choice), "Why:" explanation present.

  If anything misbehaves, fix before committing. Stop the dev server.

- [ ] **Step 4.23:** Stage and commit Task 4 atomically.

  ```powershell
  git add tsconfig.json next.config.ts package.json pnpm-lock.yaml
  git add app/layout.tsx app/page.tsx
  git add app/lib/ app/hooks/ app/components/
  git rm --cached jsconfig.json next.config.js app/layout.js app/page.js app/questions.js app/SatPractice.jsx 2>$null
  git add -u   # picks up the on-disk deletions of files already tracked
  git status --short
  ```
  Expected status entries:
  - `A  tsconfig.json`
  - `A  next.config.ts`
  - `M  package.json`
  - `M  pnpm-lock.yaml`
  - `A  app/layout.tsx`
  - `A  app/page.tsx`
  - `A  app/lib/questions.ts`
  - `A  app/lib/test.ts`
  - `A  app/hooks/useTestSession.ts`
  - `A  app/components/SatPractice.tsx`
  - `A  app/components/StartScreen.tsx`
  - `A  app/components/TestScreen.tsx`
  - `A  app/components/ResultsScreen.tsx`
  - `A  app/components/TopBar.tsx`
  - `A  app/components/QuestionView.tsx`
  - `A  app/components/QuestionNavigator.tsx`
  - `A  app/components/ReviewItem.tsx`
  - `D  jsconfig.json`
  - `D  next.config.js`
  - `D  app/layout.js`
  - `D  app/page.js`
  - `D  app/questions.js`
  - `D  app/SatPractice.jsx`

  If `node_modules/` or `.env*.local` appears — STOP.

  Commit:
  ```powershell
  git commit -m @'
refactor: convert sat-app to TypeScript and decompose SatPractice

Single atomic commit (per Foundation spec Step 4 sub-steps 4.1-4.9):
- Add tsconfig.json (strict mode) + TS dev deps; drop jsconfig.json
- Convert next.config.js, app/layout.js, app/page.js to .ts/.tsx
- Move and type the question bank: app/questions.js -> app/lib/questions.ts
  with Question interface, immutable seed-(rw|math)-NNN ids, answerIndex
  rename, source: 'seed' field
- Extract pure test logic to app/lib/test.ts (buildTest accepts bank as
  param so the AI sub-project can swap content sources later)
- Extract state machine + timer to app/hooks/useTestSession.ts
- Decompose UI: 1 top-level router + 3 screens + 4 sub-components
- Delete app/SatPractice.jsx

Gameplay behavior preserved verbatim; CSS module unchanged (Tailwind
cutover lands separately in Task 6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```

**Chunk 3 exit criteria:** Single new commit on `main` representing the entire Task 4 work. `pnpm type-check`, `pnpm build`, and `pnpm dev` all succeed. Manual gameplay matches pre-migration. Task 4 is complete.

---

## Chunk 4: Tasks 5–7 — Dashboard stub, Tailwind+shadcn cutover, libs

Three independent tasks, each its own commit. After this chunk: a `/dashboard` placeholder route exists, all gameplay components are styled via Tailwind utilities + shadcn primitives (the old CSS module is gone), and TanStack Query is wired (RHF + zod installed but unused).

### Task 5: Stub `/dashboard` route

**Files:**
- Create: `app/dashboard/page.tsx`

**Why this task exists:** Foundation's deliverable surface includes both `/` and `/dashboard`. The placeholder lets us wire navigation now so the Auth sub-project (#3) only has to fill in the actual content.

- [ ] **Step 5.1:** Create `app/dashboard/page.tsx` as a server component placeholder.

  ```powershell
  New-Item -ItemType Directory -Force app/dashboard | Out-Null
  ```
  ```tsx
  // Placeholder dashboard route. The Auth sub-project (#3) replaces this content
  // with a signed-in history view. Persistence sub-project (#4) wires the data.
  // The Supabase smoke test is added in Task 8 and removed when Auth lands.
  export default function DashboardPage() {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-bold mb-2">Your dashboard</h1>
        <p className="text-slate-600">
          Sign in to see your test history, scores over time, and per-skill progress.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Sign-in arrives in the next sub-project — for now this is a placeholder.
        </p>
      </main>
    );
  }
  ```
  Note: this file uses Tailwind classes from the get-go. If Task 6 hasn't run yet, the styles won't apply but the page will still render with default browser styling. Order this commit BEFORE Task 6 so each commit can stand alone (Task 5 deliberately produces an unstyled-but-functional placeholder; Task 6 then styles everything).

- [ ] **Step 5.2:** Verify routing.

  ```powershell
  pnpm dev
  ```
  - Visit http://localhost:3000 → SAT gameplay (unchanged from Task 4 commit).
  - Visit http://localhost:3000/dashboard → placeholder text renders ("Your dashboard", "Sign in to see...").
  - Stop the dev server.

- [ ] **Step 5.3:** Commit.

  ```powershell
  git add app/dashboard/
  git status --short
  ```
  Expected: only `A app/dashboard/page.tsx`.
  ```powershell
  git commit -m @'
feat: stub /dashboard placeholder route

Server-side placeholder for the post-auth history view. Auth sub-project (#3)
replaces the contents; Persistence sub-project (#4) wires up real data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```

### Task 6: Tailwind + shadcn cutover

**Files:**
- Modify: `package.json` (add Tailwind/PostCSS/shadcn-related deps)
- Create: `tailwind.config.ts`, `postcss.config.mjs`, `components.json`
- Modify: `app/globals.css` (replace with Tailwind directives)
- Create: `app/components/ui/{button,card,input,label,dialog}.tsx` (via shadcn CLI)
- Modify: all seven gameplay components + `StartScreen` + `ResultsScreen` + others — replace `styles.<className>` with Tailwind utilities and shadcn primitives
- Delete: `app/SatPractice.module.css`
- Delete: `app/page.module.css` (currently unused)

**Why this task exists:** Decision D6 in the spec — Tailwind/shadcn cutover happens inside Foundation, not later, so every component file only gets touched once during JS→TS conversion AND styling rewrite. **Accepts a known visual divergence from the pre-migration UI** (spec D6).

**Theme decision:** light-mode only. When `shadcn init` prompts for dark-mode support, choose **No / light-only**. This avoids inheriting a half-supported dark theme (Risk row 7 in the spec).

- [ ] **Step 6.1:** Install Tailwind CSS v3 and PostCSS deps.

  **Pin Tailwind to v3.** Tailwind v4 dropped the `init` CLI, uses a different `@import "tailwindcss"` directive, and requires `@tailwindcss/postcss` — the rest of this task is written for v3 because shadcn's `init` flow assumes v3. Bumping to v4 is a future sub-project, not Foundation.

  ```powershell
  pnpm add -D tailwindcss@^3 postcss autoprefixer
  pnpm dlx tailwindcss@^3 init -p
  ```
  Expected: `tailwindcss` (a 3.x version) plus `postcss` and `autoprefixer` appear in `devDependencies`; `tailwind.config.js` and `postcss.config.js` are created. If `pnpm dlx tailwindcss init` errors with "Unknown command: init", you got v4 — `pnpm remove tailwindcss && pnpm add -D tailwindcss@^3` then re-run init.

- [ ] **Step 6.2:** Convert the Tailwind config to TS and configure `content` paths.

  Delete the JS configs (we'll write TS/MJS equivalents):
  ```powershell
  Remove-Item tailwind.config.js
  Remove-Item postcss.config.js -ErrorAction SilentlyContinue
  ```
  Create `tailwind.config.ts`:
  ```ts
  import type { Config } from 'tailwindcss';

  const config: Config = {
    content: [
      './app/**/*.{ts,tsx}',
    ],
    theme: {
      extend: {},
    },
    plugins: [],
  };

  export default config;
  ```
  Create `postcss.config.mjs`:
  ```js
  export default {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  };
  ```

- [ ] **Step 6.3:** Replace `app/globals.css` with Tailwind directives.

  Open `app/globals.css`. Replace its contents with:
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  /* Body baseline — Tailwind's preflight resets margins; keep the system font stack. */
  html, body {
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #0f172a;             /* slate-900 */
    background: #f8fafc;        /* slate-50 */
  }
  ```

- [ ] **Step 6.4:** Initialize shadcn/ui.

  ```powershell
  pnpm dlx shadcn@latest init
  ```
  Answer the prompts:
  - **TypeScript?** yes
  - **Style** → default (`new-york` style is also fine — pick one and stick with it)
  - **Base color** → slate
  - **CSS file** → `app/globals.css`
  - **CSS variables for theming?** yes (lets the slate baseline live in `globals.css`)
  - **Tailwind prefix** → blank (no prefix)
  - **`tsconfig.json` paths alias?** `@/*` (matches what we already have)
  - **Components directory?** `app/components/ui` (where shadcn primitives land)
  - **Server components?** yes (Next.js App Router default)
  - **Dark mode?** **no / light-only** — IMPORTANT, see theme decision above

  Expected: `components.json` is created; `app/globals.css` is rewritten by shadcn to include the slate CSS-variables base (typically two `@layer base { ... }` blocks: one with `:root { --background: ...; --foreground: ...; ... --primary: ...; --radius: ...; }` and one with `* { @apply border-border; } body { @apply bg-background text-foreground; }`); `tailwind.config.ts` may be updated to include shadcn's `theme.extend`. **CRITICAL — preserve the shadcn-generated blocks:** they are what give every shadcn primitive (`<Button>`, `<Card>`, etc.) its colors. Then APPEND (do not replace) our custom `html, body { font-family: ... }` rule from Step 6.3 AFTER the shadcn blocks (later declarations win on equal specificity, so the font-family override works). If you accidentally end up with ONLY the Step-6.3 contents, the shadcn primitives will appear unstyled — restore from `git diff` of `app/globals.css`.

- [ ] **Step 6.5:** Add the base shadcn primitives.

  ```powershell
  pnpm dlx shadcn@latest add button card input label dialog
  ```
  Expected: five new files under `app/components/ui/`: `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `dialog.tsx`. shadcn may install additional Radix UI peer deps automatically (`@radix-ui/react-dialog`, etc.).

**Step 6.6 spans Steps 6.6.1 through 6.6.8** — one checkbox per component file, since the className rewrite is ~30 references per file and lumping them into one checkbox makes progress untrackable. Do them in the order listed; after each file, run `pnpm dev` and click-check the screen the file renders before moving on.

  **Shared work pattern for every file:**

  1. Delete the line `import styles from '@/app/SatPractice.module.css';`.
  2. Replace `<button>` → shadcn's `<Button>` (imported from `'@/app/components/ui/button'`).
  3. Replace `<input>` → shadcn's `<Input>` (from `'@/app/components/ui/input'`); `<label>` → `<Label>`.
  4. Replace `<div className={styles.card}>...</div>` → `<Card><CardContent>...</CardContent></Card>` (imports from `'@/app/components/ui/card'`). **`reviewQ` items are NOT wrapped in `<Card>`** — only top-level page cards are.
  5. Replace each remaining `className={styles.X}` with Tailwind utilities per the mapping table below.

  **Inline `style` props from the original JSX:**

  - Static spacing/layout values (e.g., `style={{ marginBottom: 18 }}`, `style={{ marginTop: 22, justifyContent: 'space-between' }}`, `style={{ visibility: ... }}`, `style={{ marginTop: 16 }}`, `style={{ margin: '22px 0 12px' }}`) → convert to Tailwind utilities (`mb-[18px]`, `mt-[22px] justify-between`, `invisible`/`visible`, `mt-4`, `my-[22px] mb-3`). Arbitrary-value classes like `mb-[18px]` are fine for one-off values.
  - **KEEP the dynamic progress bar inline style:** `style={{ width: \`${Math.round(pct * 100)}%\` }}` on the progress bar's `<span>` child. Tailwind cannot generate dynamic-percentage classes at build time. Keep it as an inline style.

  **Mapping table (CSS-module class → Tailwind utilities):**

  | `styles.<class>` | Tailwind equivalent |
  |---|---|
  | `.wrap` | `mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16` |
  | `.h1` | `text-3xl font-semibold mb-1.5` |
  | `.h2` | `text-base font-semibold mb-3` |
  | `.lead` | `text-slate-500 mb-6` |
  | `.card` | replaced by shadcn `<Card><CardContent>` |
  | `.pill` | `inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 mb-3` |
  | `.field` | `block text-sm font-semibold` |
  | `.input` | replaced by shadcn `<Input>` |
  | `.btnRow` | `flex flex-wrap gap-2.5 mt-2` |
  | `.btnPrimary` | `<Button variant="default">` (shadcn) |
  | `.btnGhost` | `<Button variant="secondary">` |
  | `.selectedOpt` | conditional: `selected ? 'ring-2 ring-blue-500 bg-blue-50' : ''` merged into the secondary `<Button>` className. (Original CSS adds a blue background tint — the `bg-blue-50` preserves that; drop it if you prefer ring-only.) |
  | `.note` | `text-sm text-slate-500 mt-3` |
  | `.topbar` | `sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-white px-4 sm:px-5 py-2.5 shadow-sm` |
  | `.seg` | `text-xs text-slate-500` (with `<b>` getting `text-slate-900` from the global) |
  | `.timer` | base: `tabular-nums font-bold text-lg rounded-md px-3 py-1 bg-indigo-50 text-indigo-900` |
  | `.timer.warn` | merge: `bg-amber-100 text-amber-700` (replace indigo) |
  | `.timer.danger` | merge: `bg-red-100 text-red-700` |
  | `.qMeta` | `text-xs uppercase tracking-wide text-slate-500 mb-2` |
  | `.passage` | `bg-slate-50 border-l-4 border-blue-500 rounded-md p-4 mb-4 whitespace-pre-wrap` |
  | `.prompt` | `text-lg font-semibold mb-4` |
  | `.choices` | `flex flex-col gap-2.5` |
  | `.choice` | `flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 cursor-pointer transition hover:border-blue-500 hover:bg-blue-50` |
  | `.choice.selected` | merge: `border-blue-500 bg-blue-50 ring-1 ring-blue-500` (Original CSS uses `box-shadow: inset 0 0 0 1px var(--blue)` — Tailwind's `ring-1` is an outer ring not an inset shadow. Visually close, intentionally not pixel-identical per D6. If you want inset, use `ring-1 ring-inset ring-blue-500`.) |
  | `.ltr` | `font-bold text-blue-600 min-w-[20px]` |
  | `.navgrid` | `flex flex-wrap gap-2 my-4` |
  | `.navbtn` | `w-10 h-10 rounded-md bg-slate-100 text-slate-900 font-semibold border border-slate-200 cursor-pointer` |
  | `.navbtn.answered` | merge: `bg-blue-600 text-white border-blue-600` |
  | `.navbtn.current` | merge: `outline outline-2 outline-blue-300` |
  | `.scorebox` | `text-center py-2 pb-4` |
  | `.big` | `text-6xl font-extrabold text-blue-600 leading-none` |
  | `.subText` | `text-slate-500 mt-1.5` |
  | `.bar` | `h-3 rounded-full bg-slate-200 overflow-hidden my-4 mb-1.5` |
  | `.bar > span` | child: `block h-full bg-blue-600` |
  | `.breakdown` | `flex flex-wrap gap-3.5 my-4` |
  | `.stat` | `bg-slate-50 rounded-md px-4 py-2.5 text-center min-w-[120px]` |
  | `.statN` | `text-2xl font-bold` |
  | `.statL` | `text-xs text-slate-500 mt-0.5` |
  | `.reviewQ` | `border-t border-slate-200 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0` |
  | `.tag` | `inline-block ml-2 rounded-full px-2 py-0.5 text-xs font-semibold` |
  | `.tag.tagOk` | merge: `bg-emerald-100 text-emerald-700` |
  | `.tag.tagNo` | merge: `bg-red-100 text-red-700` |
  | `.tag.tagSkip` | merge: `bg-slate-200 text-slate-700` |
  | `.ansLine` | `text-sm mt-2` |
  | `.correct` | `text-emerald-700 font-semibold` |
  | `.wrong` | `text-red-700 font-semibold` |
  | `.explain` | `mt-3 text-sm text-slate-700` |
  | `.explain b` | the inline `<b>Why:</b>` — add `text-blue-700` if you want the source-CSS blue accent; otherwise let it inherit |

  **Implementation hint:** use the `clsx` helper (already a shadcn transitive dep) to merge conditional classes cleanly. Example for `.timer` with state:
  ```tsx
  import { clsx } from 'clsx';
  // ...
  const timerClass = clsx(
    'tabular-nums font-bold text-lg rounded-md px-3 py-1',
    remaining <= 30 ? 'bg-red-100 text-red-700'
      : remaining <= 120 ? 'bg-amber-100 text-amber-700'
      : 'bg-indigo-50 text-indigo-900',
  );
  ```

  This is the largest mechanical edit in Foundation. Per-component checkbox list:

  - [ ] **Step 6.6.1:** Rewrite `app/components/SatPractice.tsx` (the thin router — only style usage is none directly; verify it doesn't import the CSS module). Just confirm.
  - [ ] **Step 6.6.2:** Rewrite `app/components/StartScreen.tsx`. Drop the CSS module import, swap `<button>` to `<Button>`, swap `<input>` to `<Input>`/`<Label>`, wrap the outer card in `<Card><CardContent>`, apply mapping-table classes. Run `pnpm dev` → visit `/` → start screen renders with shadcn-styled inputs and buttons.
  - [ ] **Step 6.6.3:** Rewrite `app/components/TopBar.tsx`. Replace `styles.topbar/seg/timer/warn/danger` with mapping-table utilities + the `clsx` pattern from the hint above. No shadcn primitives here (no buttons in TopBar).
  - [ ] **Step 6.6.4:** Rewrite `app/components/QuestionView.tsx`. Replace `styles.qMeta/passage/prompt/choices/choice/selected/ltr/btnRow` mappings. Swap the prev/next `<button>` elements for `<Button variant="secondary">` and `<Button>` (default = primary).
  - [ ] **Step 6.6.5:** Rewrite `app/components/QuestionNavigator.tsx`. Replace `styles.card/h2/navgrid/navbtn/answered/current/btnRow` mappings; swap the numbered `<button>`s for raw `<button>` with Tailwind utilities (40px squares; shadcn `<Button>` is overkill here), and the "Submit section/test" button for `<Button>`.
  - [ ] **Step 6.6.6:** Rewrite `app/components/TestScreen.tsx`. This is mostly composition (no direct styles); confirm the only style usage is the outer `<div className={styles.wrap}>` and replace it with the mapping-table `mx-auto max-w-3xl ...` classes.
  - [ ] **Step 6.6.7:** Rewrite `app/components/ReviewItem.tsx`. Replace `styles.reviewQ/qMeta/tag/tagSkip/tagOk/tagNo/passage/prompt/ansLine/correct/wrong/explain`. `reviewQ` rows are NOT wrapped in `<Card>` (use border-t utilities). Preserve the `dangerouslySetInnerHTML` for the explanation.
  - [ ] **Step 6.6.8:** Rewrite `app/components/ResultsScreen.tsx`. Outer `<div className={styles.wrap}>` → mapping utilities; the score card uses `<Card><CardContent>`; the per-section breakdown uses `styles.breakdown/stat/statN/statL` mappings; the "Start a New Test"/"Show full review" buttons become `<Button>` and `<Button variant="secondary">`. The review block (when `showReview`) is NOT inside a `<Card>` — it's just a series of `<ReviewItem>` rows.

- [ ] **Step 6.7:** Delete the CSS modules.

  ```powershell
  Remove-Item app/SatPractice.module.css
  Remove-Item app/page.module.css -ErrorAction SilentlyContinue
  ```

- [ ] **Step 6.8:** Verify nothing still imports the deleted modules.

  PowerShell:
  ```powershell
  Get-ChildItem -Path app -Recurse -Include *.tsx, *.ts | Select-String -Pattern "SatPractice\.module\.css|page\.module\.css"
  ```
  Expected: zero matches. If anything matches, fix that file's import.

- [ ] **Step 6.9:** Type-check and build.

  ```powershell
  pnpm type-check
  pnpm build
  ```
  Expected: zero errors from both. If type-check fails on `styles.X` references that weren't migrated, fix them. If `pnpm build` fails on a missing CSS module, fix the import.

- [ ] **Step 6.10:** Manual gameplay verification on Tailwind + shadcn.

  ```powershell
  pnpm dev
  ```
  Full click-through at http://localhost:3000:
  - Start screen: card layout intact, name input is the shadcn `<Input>` styling, Quick/Full buttons are `<Button variant="secondary">` with the selected one ringed.
  - Test screen: top bar is sticky, timer color shifts at ≤120s and ≤30s thresholds, choices are clickable cards, selected choice has the blue ring.
  - Navigator grid: answered cells are filled blue, current cell has the light-blue outline.
  - Results screen: big scaled-score number renders, per-section breakdown chips, "Show full review" toggle works.
  - `/dashboard`: placeholder text now styled with Tailwind classes (centered max-width, slate colors).

  Visual divergence from pre-migration is acceptable (spec D6). What MUST hold: gameplay behavior is identical.

- [ ] **Step 6.11:** Commit.

  ```powershell
  git add tailwind.config.ts postcss.config.mjs components.json package.json pnpm-lock.yaml
  git add app/globals.css
  git add app/components/
  git rm app/SatPractice.module.css
  git rm app/page.module.css
  git status --short
  ```
  (Both CSS modules are tracked from the Chunk 1 baseline; `git rm` stages the deletions directly. No need for stderr redirection — if the path is wrong, you want the error.)
  Expected: `A tailwind.config.ts`, `A postcss.config.mjs`, `A components.json`, `M package.json`, `M pnpm-lock.yaml`, `M app/globals.css`, `M` on each rewritten component (`SatPractice.tsx`, `StartScreen.tsx`, `TestScreen.tsx`, `TopBar.tsx`, `QuestionView.tsx`, `QuestionNavigator.tsx`, `ResultsScreen.tsx`, `ReviewItem.tsx`), `A` on the shadcn primitives under `app/components/ui/`, and `D` on the two CSS modules.

  ```powershell
  git commit -m @'
refactor: Tailwind + shadcn cutover; delete CSS module

Replaces app/SatPractice.module.css with Tailwind utilities and shadcn
primitives (Button, Card, Input, Label, Dialog). Light-mode only;
dark-mode tokens explicitly not generated (spec Risk row 7).

Gameplay behavior unchanged. Visual divergence from pre-migration UI
is expected and accepted (spec Decision D6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```

### Task 7: Wire TanStack Query, RHF, zod (libraries staged)

**Files:**
- Modify: `package.json` (deps)
- Create: `app/providers.tsx`
- Modify: `app/layout.tsx` (wrap children in `<Providers>`)

**Why this task exists:** OneReal-stack libraries staged for the Auth and AI sub-projects. Only TanStack Query needs actual wiring in Foundation (the `<QueryClientProvider>`). RHF and zod are installed but unused — they'll consume their first form when Auth lands.

- [ ] **Step 7.1:** Install the three libraries.

  ```powershell
  pnpm add @tanstack/react-query react-hook-form zod @tanstack/react-query-devtools
  ```
  Note: `@tanstack/react-query-devtools` is installed as a **regular dependency**, not devDependency. The render-time `NODE_ENV` check in Step 7.2 prevents it from rendering in production, but the import still has to resolve at build time — making it a dependency keeps it in `node_modules` on a `--prod` install. The bundle stays small because Next.js tree-shakes the dev component out of the production client chunk when the guard's condition is statically false in prod builds.

- [ ] **Step 7.2:** Create `app/providers.tsx`.

  ```tsx
  'use client';

  import { useState, type ReactNode } from 'react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  // Dev-only render guard below; the import is a regular dependency so the
  // module resolves at build time, but the rendered subtree is empty in prod.
  import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

  export function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,
          refetchOnWindowFocus: false,
        },
      },
    }));

    return (
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    );
  }
  ```
  The `useState(() => new QueryClient(...))` pattern is the recommended React 18+ / SSR-safe way to ensure one client per browser session (not one per render).

- [ ] **Step 7.3:** Update `app/layout.tsx` to wrap children in `<Providers>`.

  Open `app/layout.tsx`. Change the body to wrap in `<Providers>`:
  ```tsx
  import type { Metadata, ReactNode } from 'react';
  import './globals.css';
  import { Providers } from './providers';

  export const metadata: Metadata = {
    title: 'SAT Practice Test',
    description: 'A timed, replayable SAT-style practice test with instant scoring and explanations.',
  };

  export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    );
  }
  ```

- [ ] **Step 7.4:** Type-check and build.

  ```powershell
  pnpm type-check
  pnpm build
  ```
  Expected: zero errors.

- [ ] **Step 7.5:** Manual smoke.

  ```powershell
  pnpm dev
  ```
  - Visit http://localhost:3000 → gameplay still works.
  - In dev mode, the React Query Devtools floating button should appear in the corner of the page (a small floating logo).
  - Stop the dev server.

- [ ] **Step 7.6:** Commit.

  ```powershell
  git add package.json pnpm-lock.yaml app/providers.tsx app/layout.tsx
  git status --short
  ```
  Expected: `M package.json`, `M pnpm-lock.yaml`, `A app/providers.tsx`, `M app/layout.tsx`.

  ```powershell
  git commit -m @'
chore: stage TanStack Query, react-hook-form, zod

Wraps the App Router layout in <QueryClientProvider> with the
standard useState-bound QueryClient pattern for SSR safety.
Adds the React Query Devtools (dev-only). RHF and zod are
installed but unused; Auth sub-project (#3) is their first
consumer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```

**Chunk 4 exit criteria:** Three new commits (dashboard stub, Tailwind+shadcn cutover, libs). `/` and `/dashboard` both render with Tailwind styling. The React Query Devtools button is visible in dev. The CSS module is gone. `pnpm type-check` + `pnpm build` + `pnpm lint` are clean.

---

## Chunk 5: Tasks 8–9 — Supabase setup + final verification

Two final tasks. Task 8 wires the Supabase clients and creates the `sat` PostgreSQL schema (no tables). Task 9 is the docs sync + full Section-9 manual checklist + `post-foundation` tag.

### Task 8: Supabase clients + `sat` schema migration

**Files:**
- Modify: `package.json` (Supabase deps)
- Create: `app/lib/supabase/client.ts`
- Create: `app/lib/supabase/server.ts`
- Create: `.env.local` (gitignored)
- Create: `.env.example` (committed)
- Modify: `app/dashboard/page.tsx` (add smoke test)
- Create: `supabase/config.toml` (via `supabase init`)
- Create: `supabase/migrations/20260521000000_sat_schema.sql`

**Why this task exists:** Establish the Supabase plumbing (browser + server clients, SSR-aware cookies) and the `sat` namespace in the PropLedger project, with deny-by-default RLS. All subsequent sub-projects (Auth, AI, Persistence, Analytics, Admin) build on this.

- [ ] **Step 8.1:** Confirm `.gitignore` already lists `supabase/.temp/`.

  ```powershell
  Select-String -Path .gitignore -Pattern "supabase/\.temp/"
  ```
  Expected: one match (added in Task 1 Step 1.2). If empty, append `supabase/.temp/` to `.gitignore` before continuing.

- [ ] **Step 8.2:** Install Supabase deps.

  ```powershell
  pnpm add @supabase/supabase-js @supabase/ssr
  ```

- [ ] **Step 8.3:** Create `app/lib/supabase/client.ts` — browser client.

  ```powershell
  New-Item -ItemType Directory -Force app/lib/supabase | Out-Null
  ```
  ```ts
  import { createBrowserClient } from '@supabase/ssr';

  // Browser-side Supabase client. Use in 'use client' components only.
  export function createClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  ```

- [ ] **Step 8.4:** Create `app/lib/supabase/server.ts` — server client with Next 15 async cookies.

  ```ts
  import { createServerClient } from '@supabase/ssr';
  import { cookies } from 'next/headers';

  // Server-side Supabase client. Use in server components, route handlers, server actions.
  // Next 15's cookies() returns a Promise — every call here must be awaited.
  export async function createClient() {
    const cookieStore = await cookies();
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch {
              // Server Component context: cookies are immutable here. The middleware
              // (added by Auth sub-project) will refresh the session in route handlers.
            }
          },
        },
      },
    );
  }
  ```
  **Critical for Next 15:** `cookies()` returns `Promise<ReadonlyRequestCookies>`. The `await` here is non-negotiable; without it `pnpm type-check` fails. The empty `catch` block is the documented `@supabase/ssr` pattern for server-component-only contexts.

- [ ] **Step 8.5:** Create `.env.example` (committed) and `.env.local` (gitignored).

  Create `.env.example`:
  ```
  # Supabase — PropLedger project (shared org). NEXT_PUBLIC_-prefixed values
  # are exposed to the browser and are NOT secrets.
  NEXT_PUBLIC_SUPABASE_URL=https://falgykkspbtrwdcchayi.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste anon key from Supabase dashboard>
  ```
  Create `.env.local` (gitignored — verify the existing `.env*.local` pattern in `.gitignore` covers it):
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://falgykkspbtrwdcchayi.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste the real anon key from the Supabase dashboard>
  ```
  Get the anon key from https://supabase.com/dashboard/project/falgykkspbtrwdcchayi/settings/api → "Project API keys" → `anon` `public`.

  Verify `.env.local` is ignored:
  ```powershell
  git check-ignore -v .env.local
  ```
  Expected: prints `.gitignore:<line>:.env*.local .env.local`. If it says the file is NOT ignored, STOP and fix `.gitignore` before continuing.

- [ ] **Step 8.6:** Initialize the Supabase CLI workspace.

  ```powershell
  pnpm dlx supabase init
  ```
  Expected: a `supabase/` directory is created with `config.toml`. When prompted about VS Code / IntelliJ / Deno settings, decline all (we don't need them for Foundation).

- [ ] **Step 8.7:** Link to the PropLedger project.

  Pre-requisite: a Supabase access token. Generate at https://supabase.com/dashboard/account/tokens if you don't have one already. Set it:
  ```powershell
  $env:SUPABASE_ACCESS_TOKEN = '<token>'
  ```
  Link:
  ```powershell
  pnpm dlx supabase link --project-ref falgykkspbtrwdcchayi
  ```
  Expected: success; `supabase/.temp/project-ref` is created (and gitignored).

- [ ] **Step 8.8:** Write the schema migration.

  ```powershell
  New-Item -ItemType Directory -Force supabase/migrations | Out-Null
  ```
  Create `supabase/migrations/20260521000000_sat_schema.sql`:
  ```sql
  -- Foundation sub-project — creates the `sat` schema with deny-by-default RLS.
  -- Tables come with subsequent sub-projects:
  --   sat.profiles          (Auth sub-project)
  --   sat.questions         (AI sub-project)
  --   sat.test_attempts     (Persistence sub-project)
  --   sat.attempt_responses (Persistence sub-project)

  create schema if not exists sat;

  -- Deny-by-default for Supabase roles AND the implicit PUBLIC role,
  -- so future SECURITY DEFINER functions don't inherit EXECUTE accidentally.
  revoke all on schema sat from anon, authenticated, public;
  grant usage on schema sat to anon, authenticated;

  alter default privileges in schema sat
    revoke all on tables from anon, authenticated, public;
  alter default privileges in schema sat
    revoke all on sequences from anon, authenticated, public;
  alter default privileges in schema sat
    revoke all on functions from anon, authenticated, public;
  ```

- [ ] **Step 8.9:** Apply the migration.

  **Preferred path — preview branch:** if PropLedger's tier supports Supabase branching:
  ```powershell
  pnpm dlx supabase branches create foundation-schema
  pnpm dlx supabase db push --branch foundation-schema
  pnpm dlx supabase branches list   # confirm branch is healthy and shows the migration
  ```
  Then verify the schema landed on the branch by opening the Supabase **dashboard for the branch's project ref** and running `select * from pg_namespace where nspname = 'sat';` in its SQL editor (the branch has its own project ref shown by `branches list`). If satisfied, merge through the **dashboard's "Merge branch" button** — the CLI's branch-merge verb varies by version (in some `supabase` CLI versions there is no `branches merge` subcommand at all), so the dashboard is the reliable path.

  **Fallback — direct MCP application:** if branching is unavailable, apply via the claude.ai Supabase MCP:
  - Tool: `mcp__claude_ai_Supabase__apply_migration`
  - Args: project `falgykkspbtrwdcchayi`, name `sat_schema`, query = the SQL above.

  **Fallback 2 — direct CLI push:**
  ```powershell
  pnpm dlx supabase db push
  ```

  After whichever path: verify via the Supabase SQL editor (https://supabase.com/dashboard/project/falgykkspbtrwdcchayi/sql):
  ```sql
  select * from pg_namespace where nspname = 'sat';
  ```
  Expected: exactly one row.

  Verify the deny-by-default posture (run as a single "Run" execution in the SQL editor so the role set persists across statements):
  ```sql
  set role anon;
  -- Attempting any DDL in sat should fail:
  create table sat.test_should_fail (id int);
  reset role;
  ```
  Expected error message similar to `ERROR: 42501: permission denied for schema sat`. If the create succeeds, the deny-by-default grants were not applied — re-run the migration or check whether prior `grant`s on the schema exist.

- [ ] **Step 8.10:** Add the smoke test to `app/dashboard/page.tsx`.

  Update the dashboard page from Task 5 to do a server-side connectivity check:
  ```tsx
  import { createClient } from '@/app/lib/supabase/server';

  export default async function DashboardPage() {
    // Foundation smoke test: prove SSR + cookies + connection work end-to-end.
    // Uses auth.getSession() because PostgREST does not expose pg_catalog/system tables,
    // and we have no application tables yet (sat schema is empty). getSession() with no
    // active session returns { data: { session: null }, error: null } — a "success" outcome
    // that exercises the full cookie+SSR+HTTPS path.
    // Removed by the Auth sub-project (#3) when real session reads land.
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();
    console.log('[Foundation smoke]', error ? `error: ${error.message}` : 'connected');

    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-bold mb-2">Your dashboard</h1>
        <p className="text-slate-600">
          Sign in to see your test history, scores over time, and per-skill progress.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Sign-in arrives in the next sub-project — for now this is a placeholder.
        </p>
      </main>
    );
  }
  ```
  Note: `auth.getSession()` is the right smoke test because the Supabase JS client (PostgREST) only exposes the `public` schema by default — querying `pg_namespace` or other system catalogs would fail with "relation does not exist" even on a fully-connected client. `getSession()` exercises the cookies + SSR + HTTPS path without needing any tables, and with no active session returns `{ data: { session: null }, error: null }`. Expected console log: `[Foundation smoke] connected`.

- [ ] **Step 8.11:** Verify the smoke test.

  ```powershell
  pnpm type-check
  pnpm dev
  ```
  Visit http://localhost:3000/dashboard. Switch to the terminal running `pnpm dev`. Expected: `[Foundation smoke] connected` printed to the server log (it may print twice in dev mode due to React's double-render in strict mode — that's fine).

  If you see `[Foundation smoke] error: <something>`, debug:
  - `error: relation "pg_namespace" does not exist` → connection is fine, the query is wrong (unlikely — `pg_namespace` is a Postgres system view, always present).
  - Auth/token errors → the anon key in `.env.local` is wrong; copy it again from the dashboard.
  - Network errors → typo in `NEXT_PUBLIC_SUPABASE_URL` or local firewall.

  Stop the dev server.

- [ ] **Step 8.12:** Commit Task 8.

  ```powershell
  git add package.json pnpm-lock.yaml .env.example supabase/
  git add app/lib/supabase/ app/dashboard/page.tsx
  git status --short
  ```
  Expected: `M package.json`, `M pnpm-lock.yaml`, `A .env.example`, `A supabase/config.toml`, `A supabase/migrations/20260521000000_sat_schema.sql`, `A app/lib/supabase/client.ts`, `A app/lib/supabase/server.ts`, `M app/dashboard/page.tsx`.

  **Explicit safety check — `.env.local` must NOT appear:**
  ```powershell
  git diff --cached --name-only | Select-String -Pattern '\.env\.local|\.env$'
  ```
  Expected: zero matches. If anything matches, `git restore --staged .env.local` (or whichever file) and verify `.gitignore` covers `.env*.local`.

  ```powershell
  git commit -m @'
feat: supabase clients + sat schema migration

- @supabase/ssr browser + server clients; server.ts handles Next 15 async cookies()
- .env.example committed with real PropLedger project ref (NEXT_PUBLIC_, not secret)
- supabase/migrations/20260521000000_sat_schema.sql creates `sat` namespace
  with deny-by-default RLS (revoke all from anon/authenticated/public, grant
  usage only)
- /dashboard smoke test verifies SSR + cookies + connection end-to-end;
  removed by Auth sub-project when real session reads land

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```

### Task 9: Final verification + docs sync + tag

**Files:**
- Modify: `README.md` (pnpm + new file paths)
- Modify: `CLAUDE.md` (any stale claims)
- New tag: `post-foundation`

**Why this task exists:** Spec Section 9 acceptance criteria — last chance to catch regressions before declaring Foundation done. README must reflect the new commands and paths; the `post-foundation` tag lets future sub-projects diff against it as a baseline.

- [ ] **Step 9.1:** Update `README.md`.

  Open `README.md`. Apply these substitutions:
  - `npm install` → `pnpm install`
  - `npm run dev` → `pnpm dev`
  - Project structure section — replace the old file list with:
    ```
    - app/page.tsx                       home route, renders the SAT practice test
    - app/components/SatPractice.tsx     thin FSM router (Start | Test | Results)
    - app/components/{StartScreen,TestScreen,ResultsScreen,...}.tsx   screens + sub-components
    - app/hooks/useTestSession.ts        all gameplay state + timer
    - app/lib/test.ts                    pure logic (buildTest, computeResults, fmtTime)
    - app/lib/questions.ts               typed seed question bank (34 entries)
    - app/dashboard/page.tsx             placeholder, fills in after Auth sub-project
    ```
  - "Adding questions" section — update the `Question` shape to match `app/lib/questions.ts`:
    ```ts
    {
      id: 'seed-math-018',            // stable id; see Foundation spec for format
      section: 'math',
      skill: 'Linear Equations',
      prompt: '…',
      choices: ['…', '…', '…', '…'],
      answerIndex: 1,                  // was `answer` in pre-Foundation
      explanation: '…',
      source: 'seed',
    }
    ```
  - Add a one-line note: "After the AI sub-project lands, the question bank moves to Supabase; this file becomes the seed source only."

- [ ] **Step 9.2:** Spot-check `CLAUDE.md`.

  Read `CLAUDE.md`. Each gotcha section was written pre-migration. Update:
  - "Default to writing no comments" guidance still applies.
  - File paths in the Things-that-will-bite-you section — update to `app/lib/questions.ts`, `app/lib/test.ts`, `app/hooks/useTestSession.ts`, `app/components/SatPractice.tsx`. The `dangerouslySetInnerHTML` warning now lives in `app/components/ReviewItem.tsx`.
  - The `secsPerQ × question-count = section time` note remains accurate; same file (`questions.ts` now instead of `questions.js`).

- [ ] **Step 9.3:** Final automated gates.

  ```powershell
  pnpm type-check
  pnpm lint
  pnpm build
  ```
  All three: zero errors. If `pnpm lint` flags the `react-hooks/exhaustive-deps` disable in `useTestSession.ts`, that's expected (the disable comment is intentional per Step 4.9's preservation notes); confirm the warning matches what was already there before bundling commit.

- [ ] **Step 9.4:** Run the full spec Section 9 manual checklist.

  ```powershell
  pnpm dev
  ```
  Work through each item from the spec's Section 9 manual checklist:
  - [ ] `pnpm install` succeeds (already verified).
  - [ ] `pnpm type-check` reports 0 errors.
  - [ ] `pnpm lint` reports 0 errors.
  - [ ] `pnpm build` succeeds.
  - [ ] `pnpm dev` starts on http://localhost:3000.
  - [ ] `/` renders the StartScreen with shadcn-styled input/buttons.
  - [ ] Empty-name validation: clicking Start with empty name shows the alert.
  - [ ] Quick test (10+10) builds with two sections of 10 questions.
  - [ ] Full test builds with all available questions per section (17+17).
  - [ ] Timer starts at correct duration: 10×90s=15:00 for RW quick, 10×105s=17:30 for Math quick.
  - [ ] Timer color changes at the 120-second mark and again at the 30-second mark.
  - [ ] Timer hits 0 → alert fires → section advances (or test submits if last section).
  - [ ] Question navigator highlights answered (blue fill) and current (light-blue outline).
  - [ ] Submit-section confirmation appears; cancelling does not advance.
  - [ ] Results screen shows a scaled score in the 400–1600 range.
  - [ ] **Worked-example sanity check:** complete a Quick test with exactly 10/20 correct → scaled score displays `1000`.
  - [ ] "Show full review" reveals every question. Correct answers show green badge + green text + bold explanation. Wrong answers show red badge + red text + a "Correct answer:" line in green. Skipped questions show a slate badge, "Your answer: none", NO "Correct answer:" line, and the explanation.
  - [ ] "Start a New Test" returns to StartScreen with state reset; clicking Start again reshuffles.
  - [ ] `/dashboard` renders the placeholder; server log shows `[Foundation smoke] connected`.
  - [ ] `select * from pg_namespace where nspname = 'sat';` in the Supabase SQL editor returns one row.
  - [ ] `set role anon; create table sat.x (id int);` in the SQL editor → permission denied.
  - [ ] `README.md` references `pnpm` and the new component paths.
  - [ ] `app/lib/supabase/server.ts` type-checks under Next 15's async `cookies()` signature.

  If any checklist item fails, fix before tagging. Stop the dev server when done.

- [ ] **Step 9.5:** Commit docs sync.

  ```powershell
  git add README.md CLAUDE.md
  git status --short
  ```
  Expected: only `M README.md` and possibly `M CLAUDE.md`.

  ```powershell
  git commit -m @'
docs: sync README and CLAUDE.md to post-Foundation reality

- Commands updated to pnpm
- File paths updated for the decomposed App Router layout
- Question shape documented with id/answerIndex/source

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
  ```

- [ ] **Step 9.6:** Tag `post-foundation`.

  ```powershell
  git tag post-foundation
  git tag --list
  ```
  Expected output includes both `pre-ts-migration` and `post-foundation`. The diff is the entire Foundation migration:
  ```powershell
  git diff pre-ts-migration..post-foundation --stat
  ```
  This is the end-to-end summary of what Foundation changed.

**Chunk 5 exit criteria:** Two final commits (Supabase setup, docs sync). Tag `post-foundation` exists. All Section-9 acceptance criteria pass. The Foundation sub-project is complete; the AI sub-project (#2) is ready to begin.

---

## Plan Complete

All five chunks land 12 logical commits on `main` after the spec commits:

1. Pre-migration JS baseline (Task 1)
2. npm → pnpm (Task 2)
3. Next 14→15 + React 18→19 (Task 3)
4. TypeScript + decomposition (Task 4, atomic across Chunks 2-3)
5. /dashboard stub (Task 5)
6. Tailwind + shadcn cutover (Task 6)
7. TanStack/RHF/zod (Task 7)
8. Supabase clients + sat schema (Task 8)
9. README/CLAUDE.md sync (Task 9)

Plus two tags: `pre-ts-migration` (after Task 1) and `post-foundation` (after Task 9).

