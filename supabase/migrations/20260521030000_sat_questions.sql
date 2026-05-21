-- AI sub-project — question pool + per-user serve history + the draw RPC.

-- ---- sat.questions: the shared global pool --------------------------------
create table if not exists sat.questions (
  id            text primary key,                      -- 'seed-rw-NNN' | 'ai-<uuid>'
  section       text not null check (section in ('rw','math')),
  skill         text not null,
  passage       text,
  prompt        text not null,
  choices       jsonb not null,                        -- string[]
  answer_index  int  not null,
  explanation   text not null,
  source        text not null default 'ai' check (source in ('seed','ai')),
  dedup_hash    text not null unique,                  -- normalized hash of prompt+choices
  created_at    timestamptz not null default now()
);
create index if not exists questions_section_idx on sat.questions (section);

alter table sat.questions enable row level security;

-- Read-only to authenticated users; the whole pool is readable (it is shared).
-- There is intentionally NO insert/update/delete policy: even though Supabase
-- grants table privileges to `authenticated` on exposed-schema tables, RLS with
-- no write policy denies all writes. The generation endpoint writes via the
-- service role, which bypasses RLS.
create policy "questions_select" on sat.questions
  for select to authenticated using (true);

-- ---- sat.served_questions: per-user serve history ------------------------
create table if not exists sat.served_questions (
  user_id      uuid not null references auth.users (id)   on delete cascade,
  question_id  text not null references sat.questions (id) on delete cascade,
  served_at    timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index if not exists served_user_section_idx
  on sat.served_questions (user_id, served_at);

alter table sat.served_questions enable row level security;

-- A user may read only their own serve history. Writes happen only inside the
-- draw_questions RPC (security definer → bypasses RLS), so no write policy.
create policy "served_select_own" on sat.served_questions
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---- sat.draw_questions: atomic per-user test draw -----------------------
-- Returns `p_count` questions for the calling user in section `p_section`:
--  1. random questions the user has NOT been served, then
--  2. if short, the user's least-recently-served questions for that section.
-- Every returned question is recorded/refreshed in served_questions.
create or replace function sat.draw_questions(p_section text, p_count int)
returns setof sat.questions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_count int  := least(greatest(coalesce(p_count, 0), 0), 60);  -- bound the request
  v_ids   text[];
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- 1. fresh, un-served
  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id from sat.questions q
    where q.section = p_section
      and not exists (
        select 1 from sat.served_questions s
        where s.user_id = v_user and s.question_id = q.id)
    order by random()
    limit v_count
  ) fresh;

  -- 2. recycle least-recently-served if short
  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id
      from sat.questions q
      join sat.served_questions s
        on s.question_id = q.id and s.user_id = v_user
      where q.section = p_section
        and not (q.id = any(v_ids))
      order by s.served_at asc
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) recycled;
  end if;

  -- 3. record / refresh serve history
  insert into sat.served_questions (user_id, question_id, served_at)
  select v_user, unnest(v_ids), now()
  on conflict (user_id, question_id) do update set served_at = excluded.served_at;

  -- 4. return the drawn questions
  return query select * from sat.questions q where q.id = any(v_ids);
end;
$$;

grant execute on function sat.draw_questions(text, int) to authenticated;
