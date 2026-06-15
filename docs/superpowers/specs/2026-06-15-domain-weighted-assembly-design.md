# Domain-Weighted Full-Test Assembly — Design

**Date:** 2026-06-15
**Status:** Approved (assembly-only, full-tests-only, domain×difficulty matrix)
**Scope:** Make every **full** test draw to the official Digital SAT domain blueprint, preserving the existing difficulty composition and adaptive routing. Short tests, scoring, persistence, the generator, and the n8n workflow are **not** touched.

## Problem

An audit (2026-06-15) found the pool is individually SAT-grade but **domain-skewed** vs the official blueprint — too heavy on R&W Standard-English grammar (~36% vs 26%) and Math Problem-Solving/Geometry, too light on Craft & Structure, Expression of Ideas, Algebra, Advanced Math. Root cause: `draw_questions` is called with `p_skill = null`, so a test's domain mix is just a uniform-random sample of the (skewed) pool. The generator compounds it by balancing **per-skill** (Standard English has 5 skills, Expression has 2 → grammar overfills).

This change fixes **test realism** at the assembly layer: quota-draw each full test to the blueprint regardless of pool skew. (Rebalancing the pool itself via the generator is explicitly out of scope.)

## Blueprint (single source of truth, in code)

Official Digital SAT domain weights, added to `app/lib/questions.ts`:

| Section | Domain | Weight |
|---|---|---|
| R&W | Information and Ideas | 26% |
| R&W | Craft and Structure | 28% |
| R&W | Expression of Ideas | 20% |
| R&W | Standard English Conventions | 26% |
| Math | Algebra | 35% |
| Math | Advanced Math | 35% |
| Math | Problem-Solving and Data Analysis | 15% |
| Math | Geometry and Trigonometry | 15% |

`SKILL_DOMAIN: Record<string, Domain>` maps each of the 14 R&W / 21 Math skills to its domain. The map lives **only in code** — the RPC receives a skill list, so there is no SQL-side or n8n-side domain map to drift.

Per-module quotas (largest-remainder of weight × module size):
- **R&W module (27):** Info&Ideas 7, Craft&Structure 8, Expression 5, StdEnglish 7
- **Math module (22):** Algebra 8, Advanced 8, Problem-Solving/Data 3, Geometry/Trig 3

Each module independently hits the blueprint, so the full section (2 modules) does too — R&W ≈ 14/16/10/14, Math ≈ 16/16/6/6, every domain within ±1 of ideal.

## Components

### 1. `app/lib/assembly.ts` (new, pure, tested)
- `Domain` union types + `domainQuotas(section, moduleSize): Record<Domain, number>` — largest-remainder rounding of the blueprint.
- `allocateDomainDifficulty(domainQuotas, difficultyQuotas): Matrix` — deterministic **biproportional integer rounding**: produces a domain×difficulty matrix whose **row sums == domain quotas** and **column sums == difficulty quotas**. Algorithm: seed each cell with `floor(rowMargin × colMargin / N)`, then repeatedly increment the cell with the largest fractional remainder among cells whose row **and** column still have a deficit, until all margins are met (always feasible; terminates in N − Σfloor steps).
- No randomness here — allocation is deterministic given the margins; question *selection* randomness stays in the RPC (`order by random()`).

### 2. `app/lib/pool.ts` (modified)
- `drawFullTestModule1`: per section, build the matrix from `domainQuotas` × the existing `MODULE1_COMPOSITION` difficulty margins (R&W 9/9/9, Math 8/7/7); iterate non-zero `(domain, difficulty)` cells and fill each via a domain-restricted draw.
- `drawModule2`: same, with difficulty margins `{primary: 70%, medium: 30%}` (primary = easy on the 'easier' path, hard on 'harder').
- `fillSlot` becomes domain-aware with a 3-tier graceful fallback that **prioritises domain over difficulty**: (1) domain + exact difficulty → (2) domain, any difficulty → (3) any domain, that difficulty → (final) anything. Dedup across cells; the `moduleSize` invariant is preserved exactly (a module always fills to size even if a cell's pool is thin).
- `rpcDraw` gains an optional `skills: string[]` arg, passed as `p_skills`.
- `drawShortTest` and `buildFallbackBank` are unchanged (full-only scope).

### 3. `sat.draw_questions` RPC (one additive migration)
Drop+recreate (same pattern the adaptive migration used) to add optional `p_skills text[] default null`; filter `(p_skills is null or q.skill = any(p_skills))` on both the fresh and recycle queries. `p_skill` is kept for back-compat. Backed by the existing `(section, skill, difficulty) where enabled` index. **Deploy-safe ordering:** PostgREST resolves by named args, so the currently-deployed client (which omits `p_skills`) keeps working against the new signature — apply the migration first, deploy the code after.

### 4. `scripts/check-assembly.ts` (new)
Asserts: row sums == domain quotas and column sums == difficulty quotas for R&W and Math, Module 1 and Module 2; total == module size; non-negative cells; edge cases (a domain with 0 quota; difficulty margins that don't divide evenly). Run via `pnpm dlx tsx scripts/check-assembly.ts`, matching the repo's existing check-script convention.

## Non-goals (YAGNI)
- No generator/n8n rebalance (separate future effort).
- No domain weighting on short "Quick" tests (10/section is too coarse for 4 domains).
- No `domain` column on `sat.questions` (the code-side map suffices for assembly).
- No domain *ordering* within a module (counts only).

## Verification
`scripts/check-assembly.ts` + existing `check-scoring` / `check-payload` / `check-spr` / `check-analytics` (must stay green — no scoring/payload change) + `pnpm type-check` + `pnpm lint`.
