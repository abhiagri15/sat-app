-- Auth sub-project — protect sat.profiles.role from API-side privilege escalation.
--
-- Background: migration 20260521010000_sat_profiles.sql used column-scoped GRANTs
-- so the `authenticated` role could not write the `role` column. However, when the
-- `sat` schema is added to Supabase's exposed schemas, Supabase re-grants
-- table-level INSERT/UPDATE to anon/authenticated (its "grant broad, secure with
-- RLS" model), which overrides the column scoping. RLS restricts WHICH ROWS a
-- user may touch — not WHICH COLUMNS — so without this trigger an authenticated
-- user could PATCH their own row to role = 'admin'.
--
-- This BEFORE INSERT OR UPDATE trigger forces `role` to a safe value whenever the
-- statement runs as an API role (anon / authenticated). It is SECURITY INVOKER
-- (the default), so `current_user` reflects the real caller. Privileged roles
-- (postgres, service_role, supabase_admin, ...) are unaffected — admin promotion
-- via a direct DB or service-role UPDATE still works, as the spec intends.

create or replace function sat.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      -- API-created profiles always start as 'student'.
      new.role := 'student';
    elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
      -- API callers cannot change role; silently keep the existing value.
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role
  before insert or update on sat.profiles
  for each row execute function sat.protect_profile_role();
