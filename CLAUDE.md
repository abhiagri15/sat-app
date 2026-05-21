# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # first-time setup
pnpm dev              # next dev — http://localhost:3000
pnpm build            # production build
pnpm start            # serve the production build
pnpm lint             # next lint (uses Next.js defaults)
pnpm type-check       # tsc --noEmit
```

There are no tests in this project.

## Architecture

Next.js 15 **App Router**, TypeScript, React 19. The app is decomposed into focused modules.

- [app/page.tsx](app/page.tsx) — server entry, renders `<SatPractice />`.
- [app/components/SatPractice.tsx](app/components/SatPractice.tsx) — `'use client'`. Thin FSM router: `'start' | 'test' | 'results'`. Delegates all state to `useTestSession`.
- [app/hooks/useTestSession.ts](app/hooks/useTestSession.ts) — `'use client'` hook. Holds the timer (a `setInterval` ref restarted whenever `secIdx` changes), per-section `remaining[]` countdown, and `responses[secIdx][qIdx]` answer matrix.
- [app/lib/test.ts](app/lib/test.ts) — pure logic: `buildTest`, `computeResults`, `fmtTime`. No React dependencies.
- [app/lib/questions.ts](app/lib/questions.ts) — `BANK` array + `SECTION_CONFIG` + `SECTION_ORDER`. The single source of truth for content and timing.

`buildTest()` in `app/lib/test.ts` is the test-construction pipeline: filters `BANK` by section, shuffles questions, shuffles each question's choices (remapping the stored `answerIndex` to the new position), and slices to `shortCount` for "Quick" or all questions for "Full". A fresh shuffle runs on every "Start a New Test" — there is no persistence (no localStorage, no backend).

Path alias `@/*` → `./*` (repo root) is configured in `tsconfig.json`; cross-directory imports use `@/app/...`, while within a directory relative imports are the convention.

## Things that will bite you

- **Answer indices are positional, and choices get shuffled.** In `questions.ts`, `answerIndex` is the index into `choices` *as authored*. `buildTest()` rewrites both arrays in sync — never re-order one without the other.
- **Section keys are `'rw'` and `'math'`** (not `'reading'`, not `'reading-writing'`). Adding a third section requires updating `SECTION_CONFIG`, `SECTION_ORDER`, and confirming `BANK` entries use the new key.
- **Explanations render as HTML** via `dangerouslySetInnerHTML` in `app/components/ReviewItem.tsx` — existing entries contain `<b>` tags. Treat `explanation` as trusted authored content; do not pipe user input into it.
- **Timer auto-advances on zero.** The `useEffect` on `[screen, secIdx]` in `useTestSession.ts` is what restarts the interval, and `handleTimeUp` defers `setSecIdx` via `setTimeout(..., 0)` to avoid setState-mid-render. Don't "simplify" that.
- **Scaled score is a fake.** `scaled = round((400 + pct * 1200) / 10) * 10` — a linear stretch of percent-correct into the 400–1600 range, not a real SAT scale. The README and on-screen note both flag this; don't market it as accurate.
- **`secsPerQ` × question-count = section time.** Adjusting per-question time in `SECTION_CONFIG` silently rescales the whole section timer.

## Adding questions

Append to `BANK` in [app/lib/questions.ts](app/lib/questions.ts). Shape:

```ts
{
  id: 'seed-math-018',  // stable id; `seed-rw-NNN` or `seed-math-NNN`, 1-indexed
  section: 'rw' | 'math',
  skill: 'Linear Equations',
  passage: '…',         // optional, typically rw only
  prompt: '…',
  choices: ['…', '…', '…', '…'],
  answerIndex: 1,       // index into choices, before shuffle (renamed from old `answer`)
  explanation: '…',     // may contain inline HTML (<b>, <i>)
  source: 'seed',
}
```

Quick-mode pulls `shortCount` per section (currently 10). If `BANK` has fewer than `shortCount` in a section, the test silently uses what's there — bump `shortCount` or add questions to keep the experience consistent.
