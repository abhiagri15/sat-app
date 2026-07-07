# Fidelity & Resilience Pack — Design

**Date:** 2026-07-07
**Status:** Approved (user directive: close all remaining external-review gaps)
**Sub-project:** #17

## Problem

Four remaining gaps from the professional-app comparison, all buildable now:
Bluebook's passage tools (highlights, line reader) are absent; a closed tab
mid-test loses the whole attempt (Bluebook recovers); every "Explain my
mistake" costs a fresh AI call even for identical mistakes; and item-quality
anomalies (heavily flagged, pathologically easy/hard) surface nowhere — the
admin has to stumble on them.

## A. Passage highlights + line reader (test mode only)

- **Toolbar** (`TestScreen`, beside Mark for Review / eliminator): a
  "Highlighter" toggle and a "Line reader" toggle. Both render only when the
  current question HAS a passage. Both are per-session UI state — never
  persisted (the eliminator/marks precedent).
- **Highlights:** with the tool on, releasing a text selection inside the
  passage container adds a yellow highlight. Storage model: character
  intervals `[start, end)` relative to the passage's PLAIN TEXT, computed by
  walking the container's text nodes and accumulating lengths (the passage
  renders as plain text, but existing highlights split it into nodes — the
  walker is the standard technique). Overlapping/adjacent intervals are
  MERGED (pure helper). Clicking an existing highlight removes it (whole
  merged interval). Rendering: split the passage text into plain and
  `<mark>` segments from the interval list — React-escaped text throughout,
  no `dangerouslySetInnerHTML`. State: `Map<questionKey, Interval[]>` local
  to `TestScreen` (keyed like the eliminator, by question id). Selections
  that cross highlight boundaries are clamped to the passage and merged.
  Notes-on-highlights are DEFERRED (v2).
- **Line reader:** with the tool on, a focus band (~3 lines tall) follows
  the pointer's Y position over the passage container; everything above and
  below dims (two translucent masks). Escape or re-toggle turns it off.
  Keyboard: when active, ArrowUp/ArrowDown nudge the band one line-height.
  Purely visual; no state beyond band position.
- **Pure helpers** in `app/lib/highlights.ts`: `mergeIntervals`,
  `addInterval`, `removeIntervalAt(pos)`, `segmentText(text, intervals)` —
  covered by a new `scripts/check-highlights.ts`.
- Drills: excluded v1 (fidelity feature; drills show answers instantly).

## B. Mid-test crash recovery

- **Snapshot:** an in-progress full/short test writes a JSON snapshot to
  localStorage (`sat:inprogress-test:v1`) containing: schema `version`,
  `savedAt`, `testLength`, `studentName`, the full in-memory `Test`
  (questions incl. figures — a full test serializes well under the ~5 MB
  budget), `responses`, `timesMs`, `marked` (as array), `secIdx`, `modIdx`,
  `qIdx`, `remaining`, `breaksEnabled`, `breaksUsed`, `module2Path` per
  section (already inside Test), and `screen`-adjacent flags needed to
  resume mid-break (`onBreak`, `breakRemaining`).
- **Write points:** answer change, question/module/section navigation, mark
  toggle, pause/resume, break entry — throttled to at most one write per
  2 s, plus an unthrottled write on `visibilitychange → hidden` and
  `pagehide` (the crash-adjacent moments). All writes wrapped in try/catch —
  a quota error must NEVER break the test (silently skip).
- **Restore:** on the start screen, if a snapshot exists, parses, matches
  `version`, and `savedAt` is < 12 h old → show a "Resume your test?" card
  (test length, section, time remaining, saved-when) with **Resume** and
  **Discard**. Resume rehydrates the hook state exactly as saved (timers
  resume from the saved `remaining` — wall-clock while closed is NOT
  deducted; practice-pragmatic and kind) and enters `'test'` (or `'break'`)
  directly. Discard clears the snapshot.
- **Clear points:** reaching results (`finish()`), `newTest()`, starting a
  fresh test, Discard. A snapshot never coexists with the finished-attempt
  backup (`sat:pending-attempt:v1`) for the same test.
- **Integrity:** version mismatch or parse failure → treat as absent and
  clear. Restore is Strict-Mode-safe (single-fire ref) and must set ALL
  state before the timer effect can tick (set state synchronously in one
  batch, then screen last).
- Drills: excluded (a drill is 10 untimed questions; restarting is cheap).

## C. Explanation cache ("wrong-answer analysis by default", the cheap way)

- **Table `sat.mistake_explanations`:** `question_id text`, `chosen_key
  text`, `explanation text`, `takeaway text`, `model text`, `created_at`,
  PK `(question_id, chosen_key)`. RLS ON with select-for-authenticated
  (shared content — the `skill_lessons` posture); NO write policies; writes
  service-role only.
- **`chosen_key` normalization (content-stable across choice shuffles):**
  mcq → the chosen choice's TEXT, trimmed, lowercased, whitespace-collapsed
  (`mcq:<text>`); spr → `spr:<canonical>` where canonical =
  `String(parseSpr(entered).value)` when parseable, else trimmed raw. A pure
  helper `mistakeKey(...)` beside the schemas, check-script covered.
- **Flow change in `explainForUser`:** compute the key → SELECT cache →
  **hit:** return `{status:'ok', explanation, takeaway, cached: true}`
  immediately — no daily-cap check, no AI call, no cap-relevant log (a hit
  is free). **Miss:** existing cap check → generate → validate → INSERT
  cache with `ignoreDuplicates` (race-safe) → log → return. Cache ONLY
  trusted-live inputs (snapshot-sourced questions skip caching — their text
  is client-supplied).
- UI unchanged — the button simply becomes instant after the first student
  makes a given mistake. Auto-displaying cached analysis in reviews is
  deferred (v2, needs a batched read path).

## D. Admin needs-review queue (lifecycle-lite)

- **RPC `sat.admin_review_queue(p_limit int default 50)`** — security
  DEFINER, `grant execute to service_role` ONLY (called via the service
  client from admin code; not callable by students at all). Returns
  `(question_id, section, skill, difficulty, n bigint, p_value numeric,
  open_flags bigint, reasons text[])` for ENABLED questions where ANY of:
  - `open_flags >= 2`
  - `n >= 10 AND p < 0.15` (reason `'very-hard-suspect'`)
  - `n >= 10 AND p > 0.97` (reason `'too-easy'`)
  ordered by open_flags desc, then n desc. Response counts union both
  response tables (the calibration query shape).
- **UI:** new `/admin/review` page (admin layout gates it): the queue rows —
  skill, excerpt, n, p, flags, reason chips — each linking to
  `/admin/questions/[id]` where the existing disable toggle and item stats
  live. `AdminNav` gains a "Review queue" tab; the admin Overview page gains
  a count card (`needs review: N`).
- Deliberately NOT a lifecycle state machine: no new columns, no gating of
  draws — the queue is computed. The full `approved_for_scored_tests` gate
  stays deferred until response volume can sustain it (documented).

## Security invariants

- No new write policies; `mistake_explanations` writes only via
  service-role in `generation.ts`; `admin_review_queue` executable by
  service_role only. Highlights/line-reader/recovery state never leaves the
  browser (localStorage only, no PII beyond the student's own test).
- Cached explanations render React-escaped (existing `ExplainMistake` path).

## Testing

- `scripts/check-highlights.ts` — merge/add/remove/segment fixtures
  (overlap, adjacency, containment, boundary clamps).
- `scripts/check-recovery.ts` — snapshot serialize→restore round-trip
  fixture (pure serializer helpers), version-mismatch rejection.
- `mistakeKey` fixtures appended to an existing or new check script (shuffle
  invariance: same choice text at different indexes → same key; spr "3.5"
  vs "7/2" → same key).
- Gates: type-check, lint, build. Live smokes: cache hit round-trip;
  `admin_review_queue` returns sane rows.

## Deferred

Notes on highlights; auto-shown cached analysis in reviews; hard content
lifecycle; cross-device recovery (server-side snapshots); drill recovery.
