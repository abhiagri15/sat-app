-- Auth sub-project — sat.profiles.
-- Profile rows are created by application code (getOrCreateProfile), NOT by a
-- trigger on auth.users: the Property Ledger Supabase project is shared with the
-- PropLedger app, so a trigger on the shared auth.users would fire for non-SAT
-- sign-ups. App-code creation keeps the SAT app confined to the sat schema.

create table if not exists sat.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  role        text not null default 'student' check (role in ('student', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table sat.profiles enable row level security;

-- A user may read, create, and update only their own profile row.
create policy "profiles_select_own" on sat.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_own" on sat.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_own" on sat.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Foundation's deny-by-default revoked table privileges in the sat schema.
-- Grant them back COLUMN-SCOPED so authenticated users can never write `role`
-- (no role escalation): insert/update are limited to non-privileged columns.
grant select on sat.profiles to authenticated;
grant insert (id, email, full_name, avatar_url) on sat.profiles to authenticated;
grant update (email, full_name, avatar_url) on sat.profiles to authenticated;

-- updated_at maintenance (trigger on our own table — not shared infra).
create or replace function sat.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on sat.profiles
  for each row execute function sat.set_updated_at();
