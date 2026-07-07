-- The dynamic-practice hot paths (draw_drill tiers, unseen_count_for_skill)
-- filter sat.questions by skill (and difficulty) WITHOUT section, but the only
-- existing composite index leads with section (20260525050000) — unusable for
-- a bare skill = ? predicate. Additive index for the skill-scoped shapes; the
-- feature exists to grow the pool, so this bites sooner rather than later.

create index questions_skill_difficulty_enabled_idx
  on sat.questions (skill, difficulty) where enabled;
