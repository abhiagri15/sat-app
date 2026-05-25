# Skill Coverage — Design Spec (Sub-project #8)

**Status:** Draft → User review

**Part of:** The "near-real-world SAT" upgrade roadmap (sub-projects #8-#11).

## Goal

Expand the SAT app's skill taxonomy from **25 skills (10 R&W + 15 Math)** to **35 skills (14 R&W + 21 Math)** so every College Board Digital SAT domain is represented in the question pool. Add a generator-side "skill-floor override" so new (or perennially under-stocked) skills auto-populate without manual intervention.

This is the smallest and most isolated of the four upgrade sub-projects. No DB migrations, no UI changes, no schema changes. The pool fills itself within ~24h of deploy.

## Background

Today's `SKILLS` taxonomy at [app/lib/questions.ts:402-431](../../app/lib/questions.ts#L402-L431) reasonably covers the most-tested skills but is missing:

- **R&W:** Inferences, Text Structure and Purpose, Cross-Text Connections, Command of Evidence (Quantitative)
- **Math:** Right Triangle Trigonometry, Circles, Volume, Scatterplots & Models, Equivalent Expressions, Statistics (Spread)

Without these, a student practicing on this app gets zero exposure to question types that make up roughly 20-30% of a real Digital SAT.

The deliberate **deferral**: `Inference from Sample Statistics` and `Evaluating Statistical Claims` (< 5% frequency on real tests). They can be added in a future iteration if needed.

## New skills — final list

### R&W — 4 new (10 → 14)

| Skill name | College Board domain |
|---|---|
| `Inferences` | Information and Ideas |
| `Text Structure and Purpose` | Craft and Structure |
| `Cross-Text Connections` | Craft and Structure |
| `Command of Evidence (Quantitative)` | Information and Ideas |

### Math — 6 new (15 → 21)

| Skill name | College Board domain |
|---|---|
| `Right Triangle Trigonometry` | Geometry and Trigonometry |
| `Circles` | Geometry and Trigonometry |
| `Volume` | Geometry and Trigonometry |
| `Scatterplots & Models` | Problem-Solving and Data Analysis |
| `Equivalent Expressions` | Advanced Math |
| `Statistics (Spread)` | Problem-Solving and Data Analysis |

Naming follows the existing convention: descriptive but concise (e.g., the existing app uses `Slope & Lines` rather than College Board's verbose `Linear equations in two variables`).

## Skill-floor override

### The problem it solves

The per-user buffer gate shipped in commit `1dadca2` says: skip generation when `min_active_user_unseen() >= BUFFER_TARGET` (currently 100). Dhruv's min unseen today is **129**, so the generator is in no-op mode.

Adding 10 new skills creates 10 (section, skill) slots with **zero** questions each. The depth-balancing picker would naturally favor them — but the buffer gate prevents the picker from running at all. Result: new skills stay empty indefinitely.

### Behavior

Define `SKILL_FLOOR = 3`.

The generator's gate becomes:

```
if min_active_user_unseen() is NULL:
  skip (no active students)

else if min_active_user_unseen() >= BUFFER_TARGET
     AND every (section, skill) has count >= SKILL_FLOOR:
  skip (everything healthy)

else:
  generate (thinnest-first picker handles the rest)
```

The thinnest-first picker already prioritises slots with 0 questions, so new skills get filled before any other generation work.

### Why 3

- Matches `perRun = 3` — one generation batch fills a fresh skill in one run.
- Below 3, the random-within-section draw at test time has a meaningful chance of repeating questions for the same skill within a single test.
- High enough to provide minimum coverage; low enough that the override doesn't keep the generator running indefinitely.

### Expected catch-up profile

With n8n running every 30 minutes:

| Time after deploy | Expected state |
|---|---|
| t = 0 | 10 new skills at count 0; floor override fires |
| ~30 min | First run targets the thinnest skill (one of the new 10), produces ~3 questions for it. 9 new skills still below floor → override stays on. |
| ~5 hours (10 ticks) | All 10 new skills at count ≥ 3. Override flips off. |
| Steady state | Buffer gate resumes governing. Generator returns to no-op while Dhruv's min unseen stays ≥ 100. |

Total catch-up generation: ~30 questions over ~5 hours. Modest Ollama spend.

## Files touched

| File | Change |
|---|---|
| [app/lib/questions.ts](../../app/lib/questions.ts) | Extend the `SKILLS.rw` array by 4 entries and `SKILLS.math` by 6 entries. Alphabetised within each section. |
| [app/lib/ai/generate.ts](../../app/lib/ai/generate.ts) | Add skill-floor check after the buffer gate. Reuses the already-loaded `enabled` array (no extra DB hit). |
| n8n workflow Plan Batches node (workflow id `jDjJIthvf6EyKwgR`) | Update hardcoded `SKILLS` constant to mirror `app/lib/questions.ts`. Add the same skill-floor check after the buffer check. |
| [CLAUDE.md](../../CLAUDE.md) | Document the new taxonomy + skill-floor rule under "AI sub-project gotchas". |
| [README.md](../../README.md) | Brief mention of new skills in the generation section. |

## Data layer

**No migrations.** `sat.questions.skill` is plain text with no constraint or enum. New skill names insert via the existing path and are queried identically to existing ones. The `sat.user_analytics()` RPC aggregates by `skill` text, so analytics handle new skills automatically — they appear in the per-skill breakdown as students answer them.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Generator produces low-quality questions for unfamiliar skills | Low-medium | Medium | The 3-way self-verify gate already rejects ~10-20% of generations. Skill-pinning in the prompt ensures the model claims to be writing for the requested skill. Manual spot-check after deploy. |
| Ollama spend during the ~5h catch-up window | Low | Low | ~30 generations = ~150 Ollama calls = pennies. |
| Existing analytics page shows new skill names with 0 attempts for active users | Negligible | None | Students will accumulate attempts for new skills as the pool grows; the chart already handles zero-data skills gracefully (skill is included once it has at least one response). |
| `SKILLS` taxonomy drift between `questions.ts` and n8n workflow | Medium | High (Plan Batches would pick a skill the prompt doesn't know about) | Update both in the same commit. CLAUDE.md gotcha documents the requirement to keep them in sync. Consider deduplicating in a future sub-project (e.g., n8n calls a `sat.skills_taxonomy()` RPC). |

## Verification (manual, no automated tests)

After deploy:

1. **Type-check passes:** `pnpm type-check`
2. **Starting state confirmed:** run `select section, skill, count(*) from sat.questions where enabled group by 1, 2 order by 1, 3` — the 10 new skills are absent (or at 0 if pre-inserted).
3. **First post-deploy run targets a new skill:** check the next n8n execution log — the Plan Batches output should list a new skill as its target.
4. **Catch-up complete by t+5h:** re-run the count query — all 35 skills present with count ≥ 3.
5. **Skill-floor override flips off:** subsequent n8n runs become no-ops again (since buffer gate is once again the only gate).
6. **A new-skill question appears in a test:** start a new test, complete it, verify at least one of the new skill names appears in the per-skill review.

## Out of scope

- Hand-authoring seed questions for new skills — AI will fill in via the generator + self-verify gate. Quality risk accepted; can backfill seeds later if a specific new skill produces consistently poor output.
- Adjusting `perRun` or `maxBatches` to speed up catch-up — current values are adequate (catch-up completes in ~5h, fine for a one-off taxonomy expansion).
- Migrating the n8n hardcoded `SKILLS` list to a SQL-sourced source of truth — deferred to a future cleanup sub-project. For now, the two lists must be kept in sync manually with a CLAUDE.md note.
- Adding `Inference from Sample Statistics` and `Evaluating Statistical Claims` — deferred; under 5% frequency on real tests.

## Approval

This spec needs your approval before we proceed to the implementation plan. Things to specifically eyeball:

1. Skill names — match what you'd want on the analytics page.
2. `SKILL_FLOOR = 3` — agree this is the right floor.
3. n8n workflow update strategy — manual sync of the SKILLS list is OK for now, or do you want the dedupe sub-project bumped into this scope?
