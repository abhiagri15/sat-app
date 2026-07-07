# Dynamic Practice (AI lessons, coach updates, targeted top-up) — Design

**Date:** 2026-07-07
**Status:** Approved (user chose the recommended option on all three design forks)
**Sub-project:** #14 — Dynamic Practice (extends #13)

## Problem

Sub-project #13 shipped the Practice section with static in-code lessons and
pool-drawn drills. The user wants the experience fully dynamic:

1. **Lessons AI-generated**, not static.
2. **Per-student guidance that updates with performance** — a student who has
   answered questions should get new material and coaching that reflects what
   they actually got wrong.
3. **Questions regenerate on consumption** — once a student has answered a
   question they need new ones; other students who haven't seen it can still
   be served it.
4. **The practice session reflects the student's current performance state.**

Already true today (no work needed, documented so nobody rebuilds it): the
pool is shared — `draw_drill` serves fresh-unseen *per student*, so a question
answered by student A is still fresh for student B; and drill draws upsert
`served_questions`, so the hourly n8n generator's per-user buffer gate already
sees drill consumption and tops the pool up globally.

## User-selected design forks

| Fork | Decision |
|---|---|
| Lesson model | **AI base + personal layer**: one AI-generated lesson per skill, shared and cached in the DB; on top, a per-student "Coach's update" section regenerated as performance changes. Static lessons demoted to fallback-only. |
| Question top-up | **Post-drill targeted top-up**: after a drill save, if the student's unseen pool for that skill is below threshold, generate a fresh batch for that skill in the background (same quality gate as the existing generator), rate-capped. |
| Guidance refresh | **On visit when stale**: regenerate when the student opens the skill page AND has new answers since last generation (timestamp watermark); cached otherwise. |

Plus (implied by "reflect current state of performance", included):
**adaptive drill difficulty** — drill composition weighted by the student's
rolling accuracy in that skill.

## Architecture

### A. AI base lessons (shared, cached)

- New table **`sat.skill_lessons`**: `skill text primary key`, `content jsonb`
  (exact `Lesson` shape from `app/lib/lessons/types.ts`), `model text`,
  `generated_at timestamptz`. RLS: select for `authenticated` (shared
  content); no write policies — writes only via the service-role client in
  server code.
- Skill page flow (`getSkillLesson(skill)` in practice queries):
  1. AI row exists → render it (byline: "AI-generated lesson").
  2. No row → render the **static lesson as fallback immediately** (zero
     wait) and mount a client `LessonGenerating` banner that POSTs
     `/api/practice/lesson` once; the route generates, stores, and the client
     `router.refresh()`es to swap in the AI lesson. First visitor eats no
     blocking wait — the page is instantly useful either way.
- Generation prompt reuses the question generator's authenticity assets: the
  worked example must follow the skill's `RW_ARCHETYPES` format and global
  authenticity rules (blank conventions, literal punctuation choices,
  student-notes format, no letter references, no "underlined" references).
- Output is validated by a new zod **`lessonSchema`** (same bounds the static
  lessons obey: overview 1–3, strategies 3–5, traps 2–4, walkthrough 2–5, mcq
  worked example = exactly 4 choices with `correct ∈ choices`, choiceless
  example's `correct` must `parseSpr`). One retry on validation failure; if
  both attempts fail, nothing is stored and the static fallback keeps
  serving. Bad content never lands.
- Concurrency: `insert ... on conflict (skill) do nothing` — a lost race
  wastes one generation, corrupts nothing.

### B. Per-student "Coach's update" (personal layer)

- New table **`sat.skill_guidance`**: `user_id uuid`, `skill text`,
  `content jsonb`, `model text`, `based_on_latest timestamptz` (watermark:
  the timestamp of the newest response the generation saw),
  `generated_at timestamptz`, `primary key (user_id, skill)`. RLS:
  select-own; writes service-role only.
- Content shape (new zod **`guidanceSchema`**): `summary` (2–4 sentences on
  their current state in this skill — accuracy, trend, difficulty profile),
  `focus: {point, why}[]` (2–5 items referencing their *actual mistakes*),
  `nextSteps: string[]` (2–4 concrete actions). Rendered React-escaped in a
  new `CoachUpdate` section ABOVE the lesson.
- Staleness: guidance is stale when `sat.skill_latest_response(skill)` (new
  security-invoker RPC: max response timestamp for the signed-in user across
  attempt + practice responses for that skill) is newer than
  `based_on_latest`, or when no row exists and the student has ≥1 response.
  Student with zero responses in the skill → no personal section, show a
  "take a drill to unlock personalized coaching" nudge instead.
- Refresh flow: the server component renders the existing guidance (if any)
  plus, when stale, a client `GuidanceRefresher` that POSTs
  `/api/practice/guidance {skill}` and shows an "Updating your coaching…"
  shimmer; on success `router.refresh()`. The route re-checks staleness
  server-side, enforces a **10-minute per-(user, skill) cooldown** (via
  `generated_at`), gathers evidence, generates, validates, upserts. The route
  returns a discriminated status — `regenerated | cooled_down | fresh |
  error` — and the shimmer resolves accordingly: `cooled_down`/`fresh` →
  "Your coaching is up to date" (existing guidance keeps rendering, no
  refresh); `error` → subtle retry link.
- Evidence for the prompt comes from **`sat.skill_evidence(p_skill, p_limit)`**
  (new security-invoker RPC, RLS does the scoping): the student's most recent
  responses for the skill across both response tables — prompt, choices,
  chosen/entered answer, correct answer, is_correct, difficulty, timestamp —
  plus aggregate accuracy (overall and last-10). The generation prompt
  explicitly instructs the model to reference specific mistakes.
  **Precision notes:** neither response table stores `difficulty` or a
  per-row timestamp — `difficulty` comes from joining `sat.questions` by
  `question_id` (fine under invoker: `sat.questions` is
  select-for-authenticated), and the timestamp from the parent row
  (`test_attempts.created_at` / `practice_sessions.created_at`) — the same
  union-with-parent-timestamp shape `draw_drill` Tier 1 already uses.
- Note: `entered_value` is student free text and flows into the prompt.
  Injection risk is accepted: output is schema-constrained JSON rendered
  React-escaped; worst case is bad coaching text for that student only.

### C. Post-drill targeted question top-up

- After a successful drill save, the client fires-and-forgets a POST to
  `/api/practice/topup {skill}` (`keepalive: true`; no UI dependency).
- The route (session-authed): looks up the student's unseen count for the
  skill via **`sat.unseen_count_for_skill(p_skill)`** (new security-definer
  RPC — counts enabled questions of the skill not in `served_questions` for
  `auth.uid()`). If `>= TOPUP_THRESHOLD (12)` → no-op. Otherwise, checks the
  **30-minute per-(user, skill) cooldown** against **`sat.practice_topups`**
  (new service-role-only log table: user_id, skill, created_at, inserted),
  then generates a batch of **TOPUP_BATCH (5)** questions for exactly that
  (section, skill) through the SAME quality gate as the cron generator —
  zod `generatedQuestionSchema` → self-verify solve → dedup-hash → insert
  enabled rows via service role — and logs the run.
- Implementation detail: extract the per-skill batch pipeline out of
  `runGeneration()` in `app/lib/ai/generate.ts` into an exported
  `generateBatchForSkill(section, skill, count)` used by both the cron path
  and the top-up route (behavior of the cron path unchanged; includes the
  math SPR coin flip). The extraction MUST preserve the
  incremental-insert-with-`23505`-catch loop — a top-up racing the hourly
  n8n run on the dedup UNIQUE constraint counts the duplicate and continues,
  it does not throw.
- The hourly n8n generator stays untouched as the global backstop. Known,
  accepted divergence: the top-up's unseen check is **skill-level** while
  the pool's demand elsewhere is per `(section, skill, difficulty)` cell —
  a specific difficulty cell can be starved while the skill count reads
  healthy; the adaptive draw falls back across difficulties and the hourly
  generator is the difficulty-aware backstop. Do not "fix" this here
  (difficulty-targeted generation is explicitly deferred).
- The cooldown is a **best-effort** cap, not a hard one: two near-simultaneous
  saves (double-submit, two tabs) can both pass the `practice_topups` check
  and each generate a batch. Harm is one wasted Ollama batch; dedup makes the
  rows converge. Accepted — no locking.
- Client disconnect does not kill the work: Vercel functions run to
  completion (up to `maxDuration`) regardless of the caller's connection —
  the `keepalive: true` flag just lets the browser send the request during
  navigation; the server, not the client, keeps the generation alive.

### D. Adaptive drill difficulty

- Replace `sat.draw_drill` (CREATE OR REPLACE, same signature) with v2:
  - Tier 1 (currently-missed, capped at half) — unchanged. Review is review.
  - Rolling accuracy = the student's last 20 responses for the skill across
    both response tables (ordered by the parent-row timestamp, same
    union-with-parent shape as Tier 1). Bands: `< 50%` → easy-leaning quota
    (50% easy / 35% medium / 15% hard), `50–75%` or no history → balanced
    (25/50/25), `> 75%` → hard-leaning (10/35/55). Tier 1 stays
    difficulty-agnostic — say so in the migration comment.
  - Tiers 2 (fresh) and 3 (recycled) fill difficulty sub-quotas
    (largest-remainder split of the remaining count), falling back across
    difficulties freely when a sub-quota can't fill (never return fewer
    questions than the pool can supply — the existing exhaustion semantics).
  - Served upsert + missed-first ordering semantics unchanged.

### E. UI

- Skill page (`/practice/[skill]`) section order becomes: header/stats →
  **Coach's update** (or unlock nudge) → drill runner → lesson (AI base or
  fallback, with source byline) → recent drills.
- `LessonView` renders both sources identically (same `Lesson` shape); add a
  small neutral byline slot ("Lesson · updated <date>" for the AI base /
  "Standard lesson — a tailored version is being prepared" while
  generating). Deliberately neutral wording: a real student previously
  flagged AI-generated content quality, so the source is not shouted; quality
  is guarded by `lessonSchema` + the archetype rules instead.
- New components: `CoachUpdate` (presentational), `GuidanceRefresher` +
  `LessonGenerating` (small `'use client'` trigger/shimmer wrappers).
- Drill wiring: on save success, `SkillDrill` (or the hook's save callback)
  fires the top-up POST. Silent — no UI state depends on it.
- Hub unchanged.

### F. Constants (in code, no new env vars)

`TOPUP_THRESHOLD = 12`, `TOPUP_BATCH = 5`, `TOPUP_COOLDOWN_MIN = 30`,
`GUIDANCE_COOLDOWN_MIN = 10`, `EVIDENCE_LIMIT = 12`, rolling window 20.
AI provider/model: the existing `SAT_AI_PROVIDER` / `OLLAMA_*` config — the
`AIProvider` interface gains `generateLesson(...)` and `generateGuidance(...)`
as **required** methods (any future provider must implement them; the
`getProvider()` factory is unchanged), implemented by `OllamaCloudProvider`
(same chat endpoint + tolerant JSON extraction as `generateQuestions`).

### G. Routes & limits

Three new POST routes under `app/api/practice/`: `lesson`, `guidance`,
`topup`. All: NOT in `PUBLIC_PATHS` (middleware session-gates them), re-check
the session in-route (they perform service-role writes), `export const
maxDuration = 300` (Ollama calls run 30–60s; matches the existing
generate-questions route), and return JSON `{ ok, ... }`. Rate limits are the
cooldowns above, enforced against DB timestamps (serverless has no memory).

## Security invariants

- All three new tables: RLS on; `skill_lessons` select-authenticated,
  `skill_guidance` select-own, `practice_topups` policy-less. NO write
  policies anywhere; all writes via service role in server-only modules.
- New `createAdminClient` import site is confined to ONE new server-only
  module (`app/lib/practice/generation.ts`) used by the three routes; update
  CLAUDE.md's expected-match list.
- New RPCs: `unseen_count_for_skill` = security DEFINER (needs
  `served_questions`), `skill_latest_response` + `skill_evidence` = security
  INVOKER (read only RLS-scoped tables; `user_analytics` precedent). ALL new
  functions get explicit `grant execute` (deny-by-default schema).
- All AI-generated lesson/guidance content renders React-escaped — the
  `dangerouslySetInnerHTML` seed path must never apply to it.
- The topup route inserts questions with `source='ai'` through the existing
  quality gate only — no gate bypass.

## Error handling

- Lesson generation fails twice → static fallback keeps rendering; banner
  shows a quiet "couldn't refresh, using the standard lesson" state; next
  visit retries.
- Guidance generation fails → keep the previous guidance (if any) with its
  date; shimmer resolves to a subtle retry link.
- Top-up failures are logged (`console.error` + `practice_topups` row only on
  success) and invisible to the student — the drill already completed.
- All three routes: non-2xx JSON with a message; clients degrade gracefully.

## Testing

- `scripts/check-lesson-schema.ts` (new): every STATIC lesson passes
  `lessonSchema` (one schema governs both sources, so render paths can't
  diverge — and schema-vs-authoring-bounds drift surfaces immediately);
  guidance fixtures pass/fail `guidanceSchema` correctly (missing-field and
  out-of-bounds rejections).
- Existing check scripts stay green (check-lessons still enforces static
  fallback completeness — fallbacks remain load-bearing).
- Gates: type-check, lint, build.
- Live smokes (orchestrator, post-deploy of migration): draw_drill v2 returns
  correct counts with difficulty weighting for an impersonated user;
  `skill_evidence`/`skill_latest_response`/`unseen_count_for_skill` return
  sane values; one real end-to-end lesson generation against Ollama Cloud
  (then verify the stored row parses).

## Deferred (explicitly out of scope)

- Difficulty-targeted *generation* (top-up generates the default mix).
- Admin UI over `skill_lessons` / `skill_guidance` (regeneration = delete row).
- Per-question "explain differently" chat, spaced repetition, timed drills.
- Deleting the static lesson files (they are the fallback layer).
- n8n changes of any kind.
