# Skill Coverage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 new skills to the taxonomy (4 R&W + 6 Math) and a skill-floor override so the generator auto-populates them despite the per-user buffer gate.

**Architecture:** Taxonomy lives in [app/lib/questions.ts](../../app/lib/questions.ts). Generator gate lives in two places that must stay in sync — [app/lib/ai/generate.ts](../../app/lib/ai/generate.ts) (Vercel daily cron) and the n8n workflow's Plan Batches node (hourly hot path). Add `SKILL_FLOOR = 3`; gate becomes "skip iff buffer healthy AND every (section, skill) at or above floor."

**Tech Stack:** TypeScript / Next.js 15. n8n workflow SDK. No DB migrations.

**Spec:** [2026-05-25-skill-coverage-design.md](../specs/2026-05-25-skill-coverage-design.md)

---

## File Structure

| File | Change |
|---|---|
| [app/lib/questions.ts](../../app/lib/questions.ts) | Modify — extend `SKILLS.rw` (+4 entries, alphabetised) and `SKILLS.math` (+6 entries, alphabetised) |
| [app/lib/ai/generate.ts](../../app/lib/ai/generate.ts) | Modify — hoist depth calculation; add skill-floor check; restructure the early-return gate |
| n8n workflow (id `jDjJIthvf6EyKwgR`) Plan Batches node | Modify — extend hardcoded `SKILLS`; add same skill-floor logic |
| [CLAUDE.md](../../CLAUDE.md) | Modify — update generate.ts entry; add gotchas about skill-floor + n8n/app SKILLS sync |
| [README.md](../../README.md) | Modify — brief mention of expanded taxonomy |

---

## Task 1: Extend SKILLS taxonomy

**Files:**
- Modify: [app/lib/questions.ts](../../app/lib/questions.ts) lines 402-431 (the `SKILLS` constant)

- [ ] **Step 1: Add the 4 new R&W skills, alphabetised within `SKILLS.rw`**

  Insertion order:
  - `Boundaries (Modifiers)` → keep
  - `Boundaries (Punctuation)` → keep
  - `Central Ideas` → keep
  - `Command of Evidence` → keep
  - **`Command of Evidence (Quantitative)`** ← new (after `Command of Evidence`)
  - **`Cross-Text Connections`** ← new
  - `Form & Structure (Verbs)` → keep
  - **`Inferences`** ← new (after `Form & Structure`)
  - `Pronoun Agreement` → keep
  - `Rhetorical Synthesis` → keep
  - `Subject-Verb Agreement` → keep
  - **`Text Structure and Purpose`** ← new (after `Subject-Verb Agreement`)
  - `Transitions` → keep
  - `Words in Context` → keep

  Final count: 14 R&W skills.

- [ ] **Step 2: Add the 6 new Math skills, alphabetised within `SKILLS.math`**

  Insertion order (only the new entries shown in context):
  - `Exponential Growth` → keep
  - `Exponents` → keep
  - **`Circles`** ← new (after `Exponents`)
  - **`Equivalent Expressions`** ← new
  - `Functions` → keep
  - `Geometry (Area)` → keep
  - `Geometry (Triangles)` → keep
  - `Inequalities` → keep
  - `Linear Equations` → keep
  - `Linear Functions` → keep
  - `Percentages` → keep
  - `Probability` → keep
  - `Quadratics` → keep
  - `Ratios & Proportions` → keep
  - **`Right Triangle Trigonometry`** ← new
  - **`Scatterplots & Models`** ← new
  - `Slope & Lines` → keep
  - **`Statistics (Spread)`** ← new (next to `Statistics (Mean)`)
  - `Statistics (Mean)` → keep
  - `Systems of Equations` → keep
  - **`Volume`** ← new

  Final count: 21 Math skills.

  > Note: alphabetisation puts `Circles` before `Functions` (not after `Exponential Growth/Exponents`). Re-sort the array if needed — the exact insertion-after positions above are guidance; what matters is the final list is alphabetised within section.

- [ ] **Step 3: Type-check**

  Run: `pnpm type-check`
  Expected: PASS — `SKILLS` is consumed via `SECTION_CONFIG`-style typing; adding entries to the existing `string[]` arrays has no type impact.

---

## Task 2: Skill-floor override in generate.ts

**Files:**
- Modify: [app/lib/ai/generate.ts](../../app/lib/ai/generate.ts) — the `runGeneration()` function body and the `BUFFER_TARGET` block at the top

- [ ] **Step 1: Add `SKILL_FLOOR` constant near `BUFFER_TARGET`**

  ```ts
  // Each (section, skill) slot should have at least this many enabled
  // questions. If any slot is below the floor — e.g. a newly-added skill
  // — the generator runs even when the per-user buffer is healthy, so the
  // thinnest-first picker can fill it. Picked to match perRun (one batch
  // = floor count), so a fresh skill is at the floor after one generation.
  const SKILL_FLOOR = 3;
  ```

- [ ] **Step 2: Restructure the gate**

  Current shape: load pool → buffer-gate-skip-or-continue → compute depth → pick targets → generate.

  New shape: load pool → compute depth → check both gates (buffer + floor) → pick targets → generate.

  Specifically, the early-return block after the buffer RPC needs to move down, after the `enabled` array is loaded, and become:

  ```ts
  // Compute depth per (section, skill) once — used by both the floor
  // gate and the thinnest-first picker below.
  const depth = new Map<string, number>();
  for (const q of enabled) {
    const key = `${q.section}|${q.skill}`;
    depth.set(key, (depth.get(key) ?? 0) + 1);
  }
  const belowFloor = (['rw', 'math'] as const).some((section) =>
    SKILLS[section].some(
      (skill) => (depth.get(`${section}|${skill}`) ?? 0) < SKILL_FLOOR,
    ),
  );

  // Gate: skip iff buffer healthy AND every (section, skill) is at the
  // floor. Either condition failing keeps the run going.
  const bufferHealthy =
    minUnseen !== null && (minUnseen as number) >= BUFFER_TARGET;
  if (bufferHealthy && !belowFloor) {
    return summary;
  }
  ```

  The `if (minUnseen === null)` early-return stays — no active students still means no demand regardless of the floor.

- [ ] **Step 3: Drop the now-duplicated depth computation in step 3 of the original flow**

  The original `runGeneration()` builds the same `depth` map twice (once implicit in the buffer logic, once explicit before slot selection). Reuse the one we just hoisted; delete the duplicate.

- [ ] **Step 4: Type-check**

  Run: `pnpm type-check`
  Expected: PASS.

---

## Task 3: Update the n8n workflow

**Files:**
- Modify: n8n workflow `jDjJIthvf6EyKwgR`, Plan Batches node `jsCode`

- [ ] **Step 1: Update the `SKILLS` constant in Plan Batches jsCode**

  Locate the existing `SKILLS = { rw: [...], math: [...] }` definition in the Plan Batches `jsCode` template literal. Replace both arrays with the new 14+21 sets, alphabetised. Must mirror `app/lib/questions.ts` exactly.

- [ ] **Step 2: Add skill-floor check to Plan Batches jsCode**

  After computing `unattempted` / `deficit`, before the early-return, add:

  ```js
  // Compute depth per (section, skill) for both the floor gate and the
  // thinnest-first picker.
  const depth = {};
  for (const q of pool) {
    const k = q.section + '|' + q.skill;
    depth[k] = (depth[k] || 0) + 1;
  }
  let belowFloor = false;
  for (const section of ['rw', 'math']) {
    for (const skill of SKILLS[section]) {
      if ((depth[section + '|' + skill] || 0) < 3) {
        belowFloor = true;
        break;
      }
    }
    if (belowFloor) break;
  }
  const bufferHealthy = typeof minUnseen === 'number' && minUnseen >= cfg.bufferTarget;
  if (bufferHealthy && !belowFloor) {
    return [];
  }
  ```

  Then drop the duplicate depth computation that follows (the slots-building block reuses the one we just computed).

  When `belowFloor` triggers but buffer is healthy, also adjust the `batches` calculation. Right now it's `min(ceil(deficit / perRun), maxBatches)`, but `deficit` is meaningless when only the floor failed. Cap batches at `maxBatches` directly in that case:

  ```js
  const batches = bufferHealthy
    ? cfg.maxBatches
    : Math.min(Math.ceil(deficit / cfg.perRun), cfg.maxBatches);
  ```

- [ ] **Step 3: Validate workflow code**

  Use n8n SDK validate (`validate_workflow`).
  Expected: `valid: true`.

- [ ] **Step 4: Update workflow**

  Use n8n SDK `update_workflow` against workflow id `jDjJIthvf6EyKwgR`. After update, **the Config node's secrets will be reset to placeholders** (known repo-wide issue) — instruct user to re-paste at the end of the plan.

---

## Task 4: Documentation

**Files:**
- Modify: [CLAUDE.md](../../CLAUDE.md)
- Modify: [README.md](../../README.md)

- [ ] **Step 1: Update `app/lib/ai/generate.ts` entry in CLAUDE.md architecture list**

  Old text mentions `>= BUFFER_TARGET` as the only gate. New text: "skip iff buffer healthy AND every (section, skill) at SKILL_FLOOR — adds a per-skill floor gate so newly-added skills auto-populate."

- [ ] **Step 2: Add skill-floor gotcha to "AI sub-project gotchas" section in CLAUDE.md**

  Bullet: explain the dual gate (buffer + floor), why floor=3, where it's enforced (two code paths), and what triggers each.

- [ ] **Step 3: Add SKILLS-sync gotcha to CLAUDE.md**

  Bullet: `SKILLS` taxonomy lives in two places that must stay aligned — `app/lib/questions.ts` and the n8n Plan Batches node. Update both in the same change. (Future cleanup: dedupe via a SQL function.)

- [ ] **Step 4: Update README.md generation section**

  One-paragraph mention: taxonomy now covers all 8 College Board Digital SAT domains (4 R&W + 4 Math); ~35 skills total; the generator's gate skips only when the per-user buffer is healthy AND every skill has at least 3 questions.

---

## Task 5: Commit + push + verify

- [ ] **Step 1: Type-check one more time**

  Run: `pnpm type-check` — expected PASS.

- [ ] **Step 2: Stage the code-and-doc changes**

  ```bash
  git add app/lib/questions.ts app/lib/ai/generate.ts CLAUDE.md README.md
  git status --short
  ```

- [ ] **Step 3: Commit with a descriptive message**

  Title: `feat(ai): expand taxonomy to 35 skills + skill-floor override`

  Body should mention: 10 new skills (4 R&W + 6 Math); skill-floor=3 override; dual gate (buffer + floor); both code paths updated (n8n Plan Batches updated separately via workflow API since it's not in repo).

- [ ] **Step 4: Push**

  ```bash
  git push origin main
  ```

- [ ] **Step 5: Manual verification queries**

  Wait for Vercel build to complete and the next n8n hourly tick to fire. Then:

  ```sql
  -- Confirm 35 skill names and starting counts
  select section, skill, count(*) filter (where enabled) as enabled_count
  from sat.questions
  group by section, skill
  order by section, skill;
  ```

  Expected: 35 rows, with the 10 new skills at 0 initially.

  ```sql
  -- After ~5 hourly ticks, re-run; expect all 35 ≥ 3
  ```

- [ ] **Step 6: User re-pastes n8n secrets**

  Remind user (the n8n workflow update reset the Config node placeholders).

---

## Done criteria

- `pnpm type-check` passes
- `git log` shows the feat commit on `main`
- Vercel deploy succeeded
- n8n workflow shows new SKILLS in Plan Batches output
- DB query shows 35 distinct (section, skill) groupings (10 starting at 0, growing on each n8n tick)
- Within 24 hours, all 35 skills have ≥ 3 enabled questions
- A test taken by a student now has a chance of including one of the new skills

After all green, this sub-project is shipped. Move on to brainstorming #9 (Question-Format Parity).
