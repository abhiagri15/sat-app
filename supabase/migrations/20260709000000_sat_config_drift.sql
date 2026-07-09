-- Schema-drift catch-up (sub-project #21). Three sat.app_config columns were
-- added DIRECTLY to prod in earlier sessions and never captured as migration
-- files — discovered when the first local-stack `db reset` + E2E run hit
-- `column app_config.rw_module2_threshold_pct does not exist` (the app
-- degraded gracefully via the DEFAULT_MODULE2_THRESHOLD_PCT fallback).
--
-- Idempotent: `if not exists` makes this a no-op on prod (which already has
-- all three) and brings local/CI to parity. Defaults mirror prod's live
-- column defaults exactly.

alter table sat.app_config
  add column if not exists rw_module2_threshold_pct int not null default 60;

alter table sat.app_config
  add column if not exists math_module2_threshold_pct int not null default 60;

alter table sat.app_config
  add column if not exists never_served_floor int not null default 5;
