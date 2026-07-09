# SAT Practice Test (Next.js)

A timed, replayable SAT-style practice test built with React (Next.js 15, App Router, React 19).
Sign in, take timed Reading & Writing and Math sections, submit, and get an instant
score with a worked explanation for every question. "Start a New Test" reshuffles fresh,
randomized questions and answer order.

The Math section mixes multiple-choice and **student-produced-response (SPR / grid-in)**
questions — type in a numeric answer (integer, decimal, or simple fraction) just like the
real Digital SAT. A Desmos scientific calculator and a Math reference sheet are available
during Math sections from the test toolbar.

## Authentication

The app requires sign-in. Every page is gated behind authentication — unauthenticated
requests are redirected to `/login` by `middleware.ts`.

Auth routes (no session required):

| Route | Purpose |
|---|---|
| `/login` | Email/password sign-in and Google OAuth |
| `/register` | Create a new account (full name + email + password) |
| `/forgot-password` | Request a password-reset email |
| `/reset-password` | Set a new password from the email link |

Authenticated pages (`/` and `/dashboard`) live in the `app/(app)/` route group and share
a header that shows the signed-in user's name and a Sign out button.

### Environments: local Supabase stack vs prod

Local dev, E2E, the live smokes, and CI all run against a **local Supabase
stack** — no cloud project or cloud secrets needed:

```bash
npx supabase start      # boots the local stack (config in supabase/config.toml)
npx supabase db reset   # replays supabase/migrations/ + supabase/seed.sql
                        # (a balanced 252-question slice of the prod pool)
```

`.env.local` holds the well-known shared local-dev keys — they only work
against 127.0.0.1 and are not secrets. **Production** runs on the Property
Ledger Supabase project (`falgykkspbtrwdcchayi`); prod credentials live ONLY
in the gitignored `.env.operator-prod`, used deliberately and explicitly
(`--env-file=.env.operator-prod`) for operator tasks (post-migration smokes,
seed exports). Local/CI databases are built purely from
`supabase/migrations/` — a change applied to prod without a matching
migration file is schema drift and will break the next `db reset`/CI run.
See `CLAUDE.md` ("Environments") for the full discipline.

### Continuous integration

`.github/workflows/ci.yml` runs on every push: a `checks` job (type-check,
lint, the full check-script battery) and an `e2e` job (boots the same local
Supabase stack, applies migrations + seed, production build, then the full
Playwright suite). CI uses the shared local-dev defaults — zero cloud
secrets live in GitHub.

### Required Supabase dashboard setup (production project, one-time)

Three one-time dashboard tasks on the production project must be completed
before the full feature set works there:

1. **Expose the `sat` schema** — Settings → API → Exposed Schemas → add `sat` alongside
   `public`. Required for the app to read `sat.profiles` through PostgREST. Without this,
   every authenticated page fails when `getOrCreateProfile` runs.

2. **Google OAuth provider** — create a Google Cloud OAuth 2.0 Client ID (Web application;
   authorized redirect URI: `https://falgykkspbtrwdcchayi.supabase.co/auth/v1/callback`),
   then Authentication → Sign In / Providers → Google → enable and paste the client ID
   and secret. Only needed for the "Continue with Google" button.

3. **Email confirmation OFF + URL config** — Authentication → Providers → Email: confirm
   "Confirm email" is OFF (sign-up creates a session immediately). Authentication → URL
   Configuration: Site URL `https://sat-app-opal.vercel.app` (production); Redirect URLs
   allow-list includes both `https://sat-app-opal.vercel.app/**` and
   `http://localhost:3000/**` (local dev). Supabase falls back to the Site URL when a
   requested `redirectTo` is not in the allow-list, so every deployed origin must be listed.

Email/password auth works once item 3 is done. Google OAuth works once item 2 is done.
Profile reads (and thus every authenticated page) work once item 1 is done.

### Environment variables

`.env.local` points at the **local** Supabase stack (the shared local-dev
keys), plus the AI generation variables:

```
# Supabase (local stack — well-known local-dev values, not secrets)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# AI question generation (required for the generation endpoint and seed script)
SAT_AI_PROVIDER=ollama
OLLAMA_API_KEY=<ollama cloud api key>
SAT_AI_MODEL=<deepseek model tag>
# OLLAMA_BASE_URL=https://ollama.com   # optional override
SUPABASE_SERVICE_ROLE_KEY=<supabase service role key — server only, never NEXT_PUBLIC_>
CRON_SECRET=<random string for the generation endpoint>
```

## AI question generation

Each test now draws questions from a growing shared pool stored in `sat.questions`
(Supabase, `sat` schema) rather than directly from the static in-code `BANK`. The pool
is per-user, no-repeat: a user is never re-served a question they have already seen;
when all available questions for a section have been served, the least-recently-seen
questions are recycled. The `BANK` in `app/lib/questions.ts` is now the seed source
and an offline fallback only.

Questions are generated by **Ollama Cloud** (a DeepSeek model) and quality-gated
(zod schema validation → self-verify → dedup) before entering the pool.

### Cron / automated generation

Two generation drivers share the same demand gates (via the
`sat.generator_state()` RPC):

- **Primary: an n8n workflow** running every 30 minutes with a 3-model
  cross-provider vote pattern (generator → independent solver → tiebreak);
  this is where most pool growth and the quality work happens.
- **Backup: a Vercel Cron job** (`vercel.json`) that calls
  `/api/admin/generate-questions` **once a day** (`0 0 * * *`, deployed
  only) — Vercel's Hobby plan caps cron at daily; on Pro you can change the
  schedule to `0 * * * *`. This single-model path also runs the daily
  difficulty calibration and needs-review auto-flagging.

Generation is **demand-driven with a dual
gate**: (1) per-user buffer — `sat.min_active_user_unseen()` returns the
worst-off active student's unseen-enabled-question count and the run skips
while that's ≥ 100; (2) per-skill floor — every `(section, skill)` slot
must have at least 3 enabled questions. A run is a no-op only when BOTH
are satisfied. The skill floor means newly added taxonomy entries auto-
populate without a backfill — the thinnest-first picker fills them
naturally on subsequent runs. When generation does fire, it picks the
thinnest `(section, skill)` for topic variety, runs the quality gate
(zod → self-verify → dedup), and inserts survivors. It returns a JSON
summary: `{ minUnseenBefore, bufferTarget, generated, accepted,
rejectedSchema, rejectedSelfVerify, rejectedDuplicate }`. `minUnseenBefore`
is null when no active students exist yet.

The `SKILLS` taxonomy in `app/lib/questions.ts` covers all eight College
Board Digital SAT domains (14 R&W skills + 21 Math skills = 35 total).
A duplicate copy lives in the n8n workflow's Plan Batches node and must
be kept in sync.

### Trigger generation locally

```bash
curl -s -H "Authorization: Bearer <CRON_SECRET>" \
  http://localhost:3000/api/admin/generate-questions
```

A request without the header returns `401 unauthorized`.

### Seed the pool (one-time)

After setting `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, run once to upsert the
33 `BANK` entries into `sat.questions`:

```bash
pnpm dlx tsx --env-file=.env.local scripts/seed-questions.ts
```

### New env vars

| Variable | Purpose |
|---|---|
| `SAT_AI_PROVIDER` | AI provider to use (`ollama`). |
| `OLLAMA_API_KEY` | Ollama Cloud API key. |
| `SAT_AI_MODEL` | DeepSeek model tag on Ollama Cloud. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — **server-only, secret**. Used by the generation endpoint and seed script to write `sat.questions` via the service-role client. Never prefix with `NEXT_PUBLIC_`. |
| `CRON_SECRET` | Shared secret that authenticates calls to `/api/admin/generate-questions`. Vercel Cron sends it automatically when deployed. |

## Test history & review

Submitting a practice test now persists it to Supabase (`sat` schema). Each submission
writes one row to `sat.test_attempts` (the attempt summary — score, scaled score, and
section breakdown) plus one row per question to `sat.attempt_responses`. Both inserts run
transactionally through the `sat.save_attempt` security-definer RPC: the attempt and all
of its response rows commit together or not at all.

`/dashboard` lists the signed-in user's past attempts, newest first, each showing the
score and a per-section breakdown.

`/dashboard/attempts/[id]` opens a read-only review of one attempt — every question with
the user's answer marked correct, incorrect, or skipped, plus the worked explanation. The
review reads the question exactly as it was presented during that test (see the gotcha in
`CLAUDE.md` about why responses snapshot the shuffled choices).

## Scoring

Each section reports a **200–800 scaled score**; the composite is the
sum (400–1600). The numbers come from a real College Board–published
Digital SAT practice-test scoring guide. Full tests score against
adaptive two-module curves (54 R&W / 44 Math questions, like the real
Digital SAT); short tests score against single-module curves (27 / 22)
with a projection.

Short tests project their raw % onto the full-test count and look up
that — so a short attempt and a full attempt show on the same score
axis. The `(projected)` muted-grey label on the score block makes the
projection explicit.

`scaled_score` is computed server-side by `sat.save_attempt` from the
per-section `correct/total/test_length/module2_path` — the client
cannot tamper with it. The published-curve version is tracked by a
`CURVE_VERSION` sentinel in [app/lib/scoring.ts](app/lib/scoring.ts);
switching curves is a deliberate code change, not a silent rescore.

For **full tests**, the score depends on which Module 2 path was taken.
Module 1 performance determines whether you continue with the Easier
or Harder Module 2; each section then scores against one of four
adaptive curves (`RW_FULL_EASIER`, `RW_FULL_HARDER`, `MATH_FULL_EASIER`,
`MATH_FULL_HARDER`). Easier-path scores cap around 600 per section;
Harder-path scores can reach 800. Short tests are non-adaptive and use
the original single-module curves.

## Adaptive Test Structure

Full tests deliver each section in **two modules** back-to-back —
exactly like the real Digital SAT:

- **Module 1**: a fixed mixed-difficulty set (1/3 easy + 1/3 medium +
  1/3 hard). 27 questions for R&W, 22 for Math.
- **Module 2**: drawn after Module 1 submit. Two paths:
  - **Easier** — if you got below the routing threshold in Module 1
  - **Harder** — if you got at or above the threshold

Composition for Module 2 is roughly 70% primary (easy on the Easier
path, hard on the Harder path) + 30% medium, drawn fresh from the
pool with a 3-tier fallback if a specific cell is thin.

The routing threshold is stored in `sat.app_config.module2_threshold_pct`
(default 60%). The path is surfaced in the test UI ("Adaptive: Harder")
and on the results page ("Module 2: Easier path"). Short tests do not
use modules — they're a non-adaptive practice variant.

## Analytics

`/analytics` turns the user's saved attempts into a progress view. It shows a score
trend over time (an inline-SVG line chart of scaled score, oldest → newest), per-section
and per-skill accuracy bars, a focus-areas callout naming the weakest skills worth more
practice, and summary stats (tests taken, best/average score, questions answered). Users
with no attempts get an empty state pointing them to start a test.

The per-skill and per-section aggregates come from the `sat.user_analytics()` RPC; the
score trend and summary stats are derived from the attempt list. All numbers reflect
only the signed-in user's own attempts.

## Admin

`/admin` is an admin-only area for moderating the AI question pool. Browse the pool
with section and status filters, open any question in full (passage, choices with the
correct answer marked, explanation, metadata), and soft-disable a bad question — or
re-enable it later. A disabled question is never drawn into a test again.

Only users whose `sat.profiles.role` is `'admin'` can reach `/admin`; everyone else
gets a 404, and the Admin nav link is shown only to admins. To promote a user, run a
direct `UPDATE` as the service role: `update sat.profiles set role = 'admin' where id
= '<user-uuid>';`.

## Feedback

From any question in a test review, a user can report a problem with that question —
pick a reason (wrong answer, unclear, typo/formatting, other) and optionally add a
short comment. The report is stored as a flag in `sat.question_flags`.

Reported flags surface at `/admin/flags` (inside the admin area). An admin browses
them with an open/resolved/all status filter, follows each flag to the question it
points at, and marks it resolved once handled. The `/admin` page shows a running
count of open flags and links straight to the review list.

## Daily test limit

Each user can submit a limited number of tests per day (UTC calendar day). The
limit is app-wide, stored in `sat.app_config`, and **defaults to 5**. An admin
changes it at `/admin/settings`. The Start screen shows how many tests remain and
blocks starting a new one once the limit is hit; the `sat.save_attempt` RPC
enforces the same limit as a server-side backstop.

## Question-format parity

Math questions come in two shapes, matching the real Digital SAT:

- **Multiple-choice (mcq)** — pick one of four answers (~75% of Math, all of R&W).
- **Student-produced response (spr / grid-in)** — type a numeric answer (~25% of Math).
  Accepts integer (`7`), decimal (`3.14`), or simple fraction (`3/4`). Mixed numbers
  (`1 1/2`) are rejected — write `1.5` or `3/2` instead.

During Math sections the test toolbar exposes two extras:

- **Calculator** — an embedded Desmos calculator with a Scientific ⇄ Graphing
  toggle; Graphing mode uses the actual College Board Bluebook testing build.
- **Reference** — the standard SAT formula sheet (areas, special triangles, volumes,
  angles).

The generator emits SPR for ~25% of Math runs via a per-target coin flip; the share
converges over time without a shared counter. The SPR canonical answer lives on
`sat.questions.correct_answer` and is **never trusted from the client** — `save_attempt`
re-joins to `sat.questions` and computes correctness server-side via `sat.spr_is_correct`.

## Run it locally

    pnpm install
    npx supabase start      # local Supabase stack (one-time per boot)
    npx supabase db reset   # migrations + 252-question seed
    pnpm dev

Then open http://localhost:3000

## Deploy to Vercel

You have two easy options. Option A needs no command line.

### Option A - GitHub + Vercel (recommended)
1. Create a new repository on https://github.com and upload these files
   (everything here EXCEPT the node_modules folder).
2. Go to https://vercel.com, sign in with GitHub, and click Add New -> Project.
3. Import the repository. Vercel auto-detects Next.js -- leave all settings at defaults.
4. Click Deploy. In about a minute you get a live URL like https://your-project.vercel.app

### Option B - Vercel CLI (one command)
With Node.js installed on your computer, from inside this folder run:

    npx vercel

Follow the prompts (it opens a browser to log in the first time). Run "npx vercel --prod"
to push the production deployment.

## Beyond the test runner

Later sub-projects added (each documented in detail in `CLAUDE.md`):

- **Practice hub** (`/practice`) — per-skill lessons (AI-upgraded with a
  static fallback), untimed instant-feedback drills, a personal AI "coach's
  update," and "Explain my mistake" with a shared explanation cache.
- **Study planner** (`/plan`) — target score + test date → a computed weekly
  plan; miss-reason tagging feeds reason-aware advice. Week boundaries are
  computed in the student's own timezone.
- **Bluebook-fidelity test tools** — mark for review + check-your-work page,
  answer eliminator, passage highlights with notes, line reader, mandatory
  10-minute break on full tests, optional pause, mid-test crash recovery.
- **Admin area** (`/admin`) — pool moderation, user analytics, flag triage,
  needs-review queue, app config (daily limit, AI kill switch), and a health
  card (save failures, generation-run status, pool-insert heartbeat).
- **Trust & integrity** — server-recomputed scores/correctness, empirical
  difficulty calibration, AI cost guardrails (charge-before caps, kill
  switch, run ledger), a `review_status` content gate for scored tests.
- **Account & privacy** — `/privacy` + `/terms` pages, full account deletion,
  data export; public marketing page at `/how-it-works`.

## Project structure (top level)

- `app/` — Next.js App Router code: `(auth)` auth pages, `(app)` the
  authenticated app (test runner, dashboard, analytics, practice, plan,
  admin), `how-it-works` the public marketing page, `api/` cron + practice
  generation routes, `components/`, `hooks/`, `lib/` (pure logic + data
  layers).
- `supabase/` — `config.toml` (local stack), `migrations/` (the full schema,
  source of truth for local/CI databases), `seed.sql` (252-question local
  pool slice).
- `scripts/` — the check-script battery (see Commands in `CLAUDE.md`), seed
  export/import, live post-migration smokes.
- `e2e/` — the Playwright suite (spawns its own dev server; local + CI gate).
- `.github/workflows/ci.yml` — CI (checks job + local-Supabase e2e job).

`CLAUDE.md` carries the authoritative per-module map and the accumulated
design gotchas — read it before changing anything load-bearing.

## Adding questions
Open `app/lib/questions.ts` and add objects to the `BANK` array. Each question looks like:

```ts
{
  id: 'seed-math-018',            // stable id; see Foundation spec for format
  section: 'math',                // 'rw' or 'math'
  skill: 'Linear Equations',
  prompt: '…',
  choices: ['…', '…', '…', '…'],
  answerIndex: 1,                 // index of the correct choice (was `answer` pre-Foundation)
  explanation: '…',               // may contain inline HTML (<b>, <i>)
  source: 'seed',
}
```

Reading & Writing questions may also include a `passage` field. The app shuffles both the
question order and the answer choices on every test.

The AI sub-project has landed. `BANK` is now the seed source and offline fallback only — the runtime question source is the `sat.questions` pool in Supabase. To add permanent questions, insert them into `sat.questions` directly (or extend the seed script), and re-run `scripts/seed-questions.ts` with `onConflict: 'id'`.
