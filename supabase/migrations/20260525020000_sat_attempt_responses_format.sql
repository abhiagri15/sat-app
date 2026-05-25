-- Sub-project #9: Question-Format Parity — schema additions on
-- sat.attempt_responses.
--
-- Snapshots SPR-specific fields per response so the review page can
-- reconstruct the question without re-joining to sat.questions (which may
-- have changed). Same snapshot pattern that already covers choices,
-- answer_index, and explanation.

alter table sat.attempt_responses
  add column if not exists response_format text
    not null default 'mcq'
    check (response_format in ('mcq', 'spr'));

alter table sat.attempt_responses
  add column if not exists entered_value text;       -- what the student typed (SPR only)

alter table sat.attempt_responses
  add column if not exists correct_answer text;      -- SPR canonical answer (snapshot)

alter table sat.attempt_responses
  add column if not exists answer_tolerance numeric; -- SPR tolerance (snapshot, NULL = exact)
