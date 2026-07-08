-- AI cost hardening (sub-project #20, T3 — audit items B2 + C3 + C4).
--
-- See docs/superpowers/specs/2026-07-08-integrity-hardening-design.md § "T3.
-- AI cost hardening" and docs/superpowers/reviews/2026-07-08-audit-findings.md
-- § B2/C3/C4 for the evidence.
--
-- Two observability tables + a global kill switch column. Both tables follow
-- the sat.question_flags posture: RLS on, policy-less (only the service role
-- touches them, from app/lib code), with an explicit `grant all ... to
-- service_role` kept for pattern consistency (the schema-wide default
-- privileges from 20260521040000 already cover service_role, but every
-- policy-less service-role table in this schema keeps the explicit grant).
--
-- No new functions → no execute grants needed.

-- ---------------------------------------------------------------------------
-- sat.ai_attempts — a pre-charge cooldown trail for expensive AI generation.
-- Written BEFORE the Ollama call in app/lib/practice/generation.ts so a
-- failing/killed generation still consumes a cooldown slot (charge-before
-- semantics). `kind` distinguishes the shared per-skill lesson cooldown from
-- the per-(user, skill) guidance cooldown; `key` is the skill; `user_id` is
-- null for shared (lesson) rows and the user for guidance rows.
-- ---------------------------------------------------------------------------
create table if not exists sat.ai_attempts (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('lesson','guidance')),
  key          text not null,
  user_id      uuid,
  attempted_at timestamptz not null default now()
);

create index if not exists ai_attempts_kind_key_attempted_idx
  on sat.ai_attempts (kind, key, attempted_at desc);

alter table sat.ai_attempts enable row level security;
-- No policies: only the service-role client (BYPASSRLS) reads/writes this,
-- from app/lib/practice/generation.ts. Same posture as sat.question_flags.
grant all on sat.ai_attempts to service_role;

-- ---------------------------------------------------------------------------
-- sat.generation_runs — one row per runGeneration() invocation (the daily
-- cron). started_at is set first; completed_at + summary are written on every
-- return path. A started-but-never-completed row (completed_at null) is the
-- signal of a killed run (or the generator_state throw path) — surfaced by the
-- admin health card (T4). No pruning: one row/day, revisit in a year.
-- ---------------------------------------------------------------------------
create table if not exists sat.generation_runs (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  summary      jsonb
);

alter table sat.generation_runs enable row level security;
-- No policies: service-role only (written by runGeneration, read by the admin
-- health card via the service-role client). Same posture as sat.ai_attempts.
grant all on sat.generation_runs to service_role;

-- ---------------------------------------------------------------------------
-- sat.app_config.ai_enabled — global AI kill switch (audit C4). Default true
-- (fail-open). Toggled by an admin at /admin/settings (setAiEnabled server
-- action, service-role write); read via aiIsEnabled(admin) at the top of every
-- expensive AI entry point. A null/unreadable value is treated as true so an
-- observability read never bricks generation.
-- ---------------------------------------------------------------------------
alter table sat.app_config add column if not exists ai_enabled boolean not null default true;
