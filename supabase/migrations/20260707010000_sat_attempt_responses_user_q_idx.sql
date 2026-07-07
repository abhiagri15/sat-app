-- draw_drill's Tier 1 (currently-missed) correlates sat.attempt_responses by
-- (user_id, question_id) per candidate question; the existing index covers
-- user_id only. Composite index keeps the drill draw fast as attempt history
-- grows. (practice_responses got its equivalent in 20260707000000.)

create index attempt_responses_user_q_idx
  on sat.attempt_responses (user_id, question_id);
