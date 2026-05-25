-- Sub-project #9: Question-Format Parity — schema additions on sat.questions.
--
-- Adds three columns supporting Student-Produced Response (SPR / grid-in)
-- questions alongside the existing multiple-choice format. All NULL-safe with
-- defaults — existing rows become mcq automatically, no backfill required.
--
-- For mcq rows: response_format = 'mcq', correct_answer + answer_tolerance NULL,
-- choices + answer_index used as before.
-- For spr rows: response_format = 'spr', correct_answer set, choices stays as
-- a placeholder (empty array, runner ignores it), answer_index = 0 placeholder.

alter table sat.questions
  add column if not exists response_format text
    not null default 'mcq'
    check (response_format in ('mcq', 'spr'));

alter table sat.questions
  add column if not exists correct_answer text;  -- SPR canonical answer

alter table sat.questions
  add column if not exists answer_tolerance numeric;  -- SPR float tolerance; NULL = exact

-- Soft constraint: SPR rows must have a correct_answer.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_spr_has_answer' and conrelid = 'sat.questions'::regclass
  ) then
    alter table sat.questions
      add constraint questions_spr_has_answer
      check (
        response_format = 'mcq'
        or (response_format = 'spr' and correct_answer is not null)
      );
  end if;
end $$;
