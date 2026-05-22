-- Feedback sub-project — user-reported problems with pool questions.

create table if not exists sat.question_flags (
  id           uuid primary key default gen_random_uuid(),
  question_id  text not null references sat.questions (id) on delete cascade,
  user_id      uuid not null references auth.users (id)   on delete cascade,
  reason       text not null check (reason in ('wrong_answer','unclear','typo','other')),
  comment      text check (char_length(comment) <= 500),
  status       text not null default 'open' check (status in ('open','resolved')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users (id)
);
create index if not exists question_flags_status_idx
  on sat.question_flags (status, created_at desc);
create index if not exists question_flags_question_idx
  on sat.question_flags (question_id);

alter table sat.question_flags enable row level security;
-- No policies: authenticated users file flags only through submit_flag
-- (security definer); admins read/resolve through the service-role client.

create or replace function sat.submit_flag(
  p_question_id text, p_reason text, p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  insert into sat.question_flags (question_id, user_id, reason, comment)
  values (p_question_id, v_user, p_reason, nullif(trim(p_comment), ''))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function sat.submit_flag(text, text, text) to authenticated;
