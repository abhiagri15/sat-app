# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install           # first-time setup (no lockfile is committed)
npm run dev           # next dev — http://localhost:3000
npm run build         # production build
npm start             # serve the production build
npm run lint          # next lint (uses Next.js defaults; no .eslintrc in repo)
```

There are no tests in this project.

## Architecture

Next.js 14 **App Router**, plain JavaScript (no TypeScript), React 18. The entire app is effectively one client component.

- [app/page.js](app/page.js) — server entry, renders `<SatPractice />`.
- [app/SatPractice.jsx](app/SatPractice.jsx) — `'use client'`. The whole app. A three-screen state machine driven by `screen` state: `'start' | 'test' | 'results'`. Holds the timer (a `setInterval` ref restarted whenever `secIdx` changes), per-section `remaining[]` countdown, and `responses[secIdx][qIdx]` answer matrix.
- [app/questions.js](app/questions.js) — `BANK` array + `SECTION_CONFIG` + `SECTION_ORDER`. The single source of truth for content and timing.

`buildTest()` in `SatPractice.jsx` is the test-construction pipeline: filters `BANK` by section, shuffles questions, shuffles each question's choices (remapping the stored `answer` index to the new position), and slices to `shortCount` for "Quick" or all questions for "Full". A fresh shuffle runs on every "Start a New Test" — there is no persistence (no localStorage, no backend).

Path alias `@/*` → `./*` is configured in [jsconfig.json](jsconfig.json) but not currently used; relative imports are the convention.

## Things that will bite you

- **Answer indices are positional, and choices get shuffled.** In `questions.js`, `answer` is the index into `choices` *as authored*. `shuffleChoices()` rewrites both arrays in sync — never re-order one without the other.
- **Section keys are `'rw'` and `'math'`** (not `'reading'`, not `'reading-writing'`). Adding a third section requires updating `SECTION_CONFIG`, `SECTION_ORDER`, and confirming `BANK` entries use the new key.
- **Explanations render as HTML** via `dangerouslySetInnerHTML` — existing entries contain `<b>` tags. Treat `explanation` as trusted authored content; do not pipe user input into it.
- **Timer auto-advances on zero.** The `useEffect` on `[screen, secIdx]` is what restarts the interval, and `handleTimeUp` defers `setSecIdx` via `setTimeout(..., 0)` to avoid setState-mid-render. Don't "simplify" that.
- **Scaled score is a fake.** `scaled = round((400 + pct * 1200) / 10) * 10` — a linear stretch of percent-correct into the 400–1600 range, not a real SAT scale. The README and on-screen note both flag this; don't market it as accurate.
- **`secsPerQ` × question-count = section time.** Adjusting per-question time in `SECTION_CONFIG` silently rescales the whole section timer.

## Adding questions

Append to `BANK` in [app/questions.js](app/questions.js). Shape:

```js
{
  section: 'rw' | 'math',
  skill: 'Linear Equations',
  passage: '…',         // optional, typically rw only
  prompt: '…',
  choices: ['…', '…', '…', '…'],
  answer: 1,            // index into choices, before shuffle
  explanation: '…',     // may contain inline HTML (<b>, <i>)
}
```

Quick-mode pulls `shortCount` per section (currently 10). If `BANK` has fewer than `shortCount` in a section, the test silently uses what's there — bump `shortCount` or add questions to keep the experience consistent.
