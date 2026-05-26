import { randomUUID } from 'crypto';
import { getProvider } from './provider';
import { generatedQuestionSchema } from './schema';
import { dedupHash } from './dedup';
import { SKILLS } from '@/app/lib/questions';
import { isSprCorrect } from '@/app/lib/spr';
import { createAdminClient } from '@/app/lib/supabase/admin';

// Bounded per invocation to fit the serverless time budget. Each Ollama call
// (~30-60s for DeepSeek) is slow: 1 skill x batch 3 = 1 generate + up to 3
// self-verify calls (~4 calls, within maxDuration=300s). Survivors are inserted
// incrementally, so a run cut short still grows the pool. Raise these only
// alongside a larger `maxDuration` on the generation route.
const MAX_SKILLS_PER_RUN = 1;
const PER_SKILL_BATCH = 3;
// Fraction of Math generation runs that produce student-produced-response
// (grid-in) questions rather than multiple choice. Roughly matches the
// ~25% SPR share on the real Digital SAT Math section.
const SPR_PROBABILITY = 0.25;

export interface GenerationSummary {
  // The worst-off active student's unseen count at the start of the run
  // (NULL → no active students yet). Generation fires only while this is
  // below bufferTarget.
  minUnseenBefore: number | null;
  // The buffer target (from sat.generator_state) — generation runs only
  // while the worst-off student's unseen count is below this.
  bufferTarget: number;
  // The admin-controlled never-served floor at the start of the run. Any
  // (section, skill, difficulty) cell below this also triggers generation
  // even when the per-user buffer is healthy.
  neverServedFloor: number;
  generated: number;
  accepted: number;
  rejectedSchema: number;
  rejectedSelfVerify: number;
  rejectedDuplicate: number;
  // Sub-project #11 follow-up: rejected because the multi-validity check
  // found more than one valid choice (e.g. a quadratic with both roots in
  // the choice list — see the flagged question from 2026-05-25).
  rejectedMultiValid: number;
  // Multi-valid candidates that were repaired (extra valid choices rewritten
  // as plausible distractors) and accepted on re-validation. Counts only
  // saves — failed repairs increment rejectedMultiValid instead.
  repairedMultiValid: number;
}

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'] as const;

// Shape of the JSON returned by sat.generator_state() — the single source of
// truth for both the n8n workflow and this cron.
//
// worstStudentUnseen is the MIN across active students of that student's
// unseen-question count for the given scope (skill or cell). A "skill" worst
// is min-of-sum, NOT sum-of-min — sat.generator_state() computes it inside
// the SQL so we don't have to reconstruct it here.
//
// Skills/cells that have no enabled questions don't appear in the arrays;
// consumers cross-product against the canonical SKILLS list and default
// missing entries to 0 (the same student would have 0 unseen for them).
interface GeneratorStateSkill {
  section: 'rw' | 'math';
  skill: string;
  worstStudentUnseen: number;
}
interface GeneratorStateCell {
  section: 'rw' | 'math';
  skill: string;
  difficulty: Difficulty;
  worstStudentUnseen: number;
}
interface GeneratorState {
  minActiveUserUnseen: number | null;
  neverServedFloor: number;
  bufferTarget: number;
  skills: GeneratorStateSkill[];
  cells: GeneratorStateCell[];
}

export async function runGeneration(): Promise<GenerationSummary> {
  const admin = createAdminClient();
  const summary: GenerationSummary = {
    minUnseenBefore: null,
    bufferTarget: 100,
    neverServedFloor: 5,
    generated: 0,
    accepted: 0,
    rejectedSchema: 0,
    rejectedSelfVerify: 0,
    rejectedDuplicate: 0,
    rejectedMultiValid: 0,
    repairedMultiValid: 0,
  };

  // 1. Single-call snapshot — same one the n8n workflow uses. Keeps the two
  //    drivers in lockstep on the floor, buffer target, and per-cell counts.
  //    null minActiveUserUnseen means no active students yet → nothing to do.
  const { data, error } = await admin.schema('sat').rpc('generator_state');
  if (error || !data) throw error ?? new Error('generator_state returned null');
  const state = data as unknown as GeneratorState;
  summary.minUnseenBefore = state.minActiveUserUnseen;
  summary.bufferTarget = state.bufferTarget;
  summary.neverServedFloor = state.neverServedFloor;
  if (state.minActiveUserUnseen === null) {
    return summary;
  }

  // 2. Lookup maps: worst student's unseen count per skill and per cell.
  //    Skills/cells missing from the RPC default to 0 — that skill has no
  //    enabled questions at all, so every student is at 0 for it.
  const skillWorst = new Map<string, number>();
  for (const s of state.skills) {
    skillWorst.set(`${s.section}|${s.skill}`, s.worstStudentUnseen);
  }
  const cellWorst = new Map<string, number>();
  for (const c of state.cells) {
    cellWorst.set(`${c.section}|${c.skill}|${c.difficulty}`, c.worstStudentUnseen);
  }

  // 3. Per-skill floor gate. Any skill where the worst-off student has fewer
  //    unseen questions than the floor triggers replenishment for that skill.
  const belowFloor = (['rw', 'math'] as const).some((section) =>
    SKILLS[section].some(
      (skill) =>
        (skillWorst.get(`${section}|${skill}`) ?? 0) < state.neverServedFloor,
    ),
  );

  // 4. Dual gate: skip iff the overall per-user buffer is healthy AND every
  //    skill is at or above the floor for every active student. Either
  //    condition failing keeps the run going.
  const bufferHealthy = state.minActiveUserUnseen >= state.bufferTarget;
  if (bufferHealthy && !belowFloor) {
    return summary;
  }

  // 5. Picker: pick the SKILL with the lowest worst-student-unseen. Within
  //    that skill, target the DIFFICULTY cell where the worst-student-unseen
  //    is lowest — that keeps each skill growing balanced across E/M/H so
  //    the adaptive engine has stock at every level for the affected student.
  const skills: { section: 'rw' | 'math'; skill: string; worst: number }[] = [];
  for (const section of ['rw', 'math'] as const) {
    for (const skill of SKILLS[section]) {
      skills.push({
        section,
        skill,
        worst: skillWorst.get(`${section}|${skill}`) ?? 0,
      });
    }
  }
  skills.sort((a, b) => a.worst - b.worst);
  const targets: {
    section: 'rw' | 'math';
    skill: string;
    difficulty: Difficulty;
  }[] = skills.slice(0, MAX_SKILLS_PER_RUN).map((s) => {
    let bestDiff: Difficulty = 'easy';
    let bestHave = cellWorst.get(`${s.section}|${s.skill}|easy`) ?? 0;
    for (const diff of ['medium', 'hard'] as const) {
      const have = cellWorst.get(`${s.section}|${s.skill}|${diff}`) ?? 0;
      if (have < bestHave) {
        bestHave = have;
        bestDiff = diff;
      }
    }
    return { section: s.section, skill: s.skill, difficulty: bestDiff };
  });

  // 6. generate, gate, insert. SPR (math-only) is requested with a per-target
  //    coin-flip at SPR_PROBABILITY; mcq otherwise. R&W always mcq.
  const provider = getProvider();
  for (const t of targets) {
    const useSpr = t.section === 'math' && Math.random() < SPR_PROBABILITY;
    let candidates;
    try {
      candidates = await provider.generateQuestions(
        t.section, t.skill, PER_SKILL_BATCH, useSpr, t.difficulty,
      );
    } catch (e) {
      console.error('[generate] provider error', t.section, t.skill, t.difficulty, e);
      continue;
    }
    for (const candidate of candidates) {
      summary.generated++;
      const parsed = generatedQuestionSchema.safeParse(candidate);
      if (!parsed.success) { summary.rejectedSchema++; continue; }
      const q = parsed.data;
      // Pin section/skill/difficulty to what we requested — reject a question
      // the model mis-tagged (keeps the SKILLS × difficulty depth-balancing honest).
      if (q.section !== t.section || q.skill !== t.skill || q.difficulty !== t.difficulty) {
        summary.rejectedSchema++;
        continue;
      }

      // Self-verify branches on the discriminator. For mcq the model picks
      // an index and we compare to answerIndex; for spr the model types a
      // numeric answer and we compare with isSprCorrect.
      let verified = false;
      try {
        if (q.responseFormat === 'mcq') {
          const r = await provider.solve({
            responseFormat: 'mcq',
            section: q.section,
            skill: q.skill,
            passage: q.passage,
            prompt: q.prompt,
            choices: q.choices,
          });
          verified = r.responseFormat === 'mcq' && r.answerIndex === q.answerIndex;
        } else {
          const r = await provider.solve({
            responseFormat: 'spr',
            section: q.section,
            skill: q.skill,
            prompt: q.prompt,
          });
          verified =
            r.responseFormat === 'spr' &&
            isSprCorrect(r.answer, q.correctAnswer, q.answerTolerance ?? null);
        }
      } catch (e) {
        console.error('[generate] solve error', e);
        summary.rejectedSelfVerify++;
        continue;
      }
      if (!verified) { summary.rejectedSelfVerify++; continue; }

      // Multi-validity check (mcq only): the prior solve agreed on the
      // generator's claimed answer, but the choice list may still contain
      // a SECOND valid answer (e.g. a quadratic with both roots listed).
      // Ask the model to evaluate every choice and either repair-then-accept
      // or reject. SPR has no choices so this is skipped.
      let repairedChoices: string[] | null = null;
      if (q.responseFormat === 'mcq') {
        let validIndices: number[] = [];
        try {
          validIndices = await provider.findValidChoices({
            responseFormat: 'mcq',
            section: q.section,
            skill: q.skill,
            passage: q.passage,
            prompt: q.prompt,
            choices: q.choices,
          });
        } catch (e) {
          console.error('[generate] findValidChoices error', e);
          summary.rejectedMultiValid++;
          continue;
        }
        const okSingle =
          validIndices.length === 1 && validIndices[0] === q.answerIndex;
        if (!okSingle) {
          // Try to repair before dropping. Repair is only meaningful when:
          //   - the intended answer IS judged valid (model agrees with the
          //     generator about which choice is correct), AND
          //   - one or two OTHER choices are ALSO judged valid (the bug class
          //     we're targeting), AND
          //   - not ALL four are flagged valid (a hopeless case).
          const canRepair =
            validIndices.includes(q.answerIndex) &&
            validIndices.length > 1 &&
            validIndices.length < 4;
          if (!canRepair) {
            summary.rejectedMultiValid++;
            continue;
          }
          const toReplace = validIndices.filter((i) => i !== q.answerIndex);
          let repaired: { choices: string[] } | null = null;
          try {
            repaired = await provider.repairMultiValid({
              section: q.section,
              skill: q.skill,
              passage: q.passage,
              prompt: q.prompt,
              choices: q.choices,
              answerIndex: q.answerIndex,
              indicesToReplace: toReplace,
            });
          } catch (e) {
            console.error('[generate] repairMultiValid error', e);
          }
          if (repaired === null) {
            summary.rejectedMultiValid++;
            continue;
          }
          // Re-run findValidChoices on the repaired list. Only accept if
          // exactly the intended answer is valid now.
          let reValid: number[] = [];
          try {
            reValid = await provider.findValidChoices({
              responseFormat: 'mcq',
              section: q.section,
              skill: q.skill,
              passage: q.passage,
              prompt: q.prompt,
              choices: repaired.choices,
            });
          } catch (e) {
            console.error('[generate] re-findValidChoices error', e);
            summary.rejectedMultiValid++;
            continue;
          }
          if (reValid.length !== 1 || reValid[0] !== q.answerIndex) {
            // Repair didn't hold — drop.
            summary.rejectedMultiValid++;
            continue;
          }
          // Repair succeeded. Use the repaired choice list for the insert.
          repairedChoices = repaired.choices;
          summary.repairedMultiValid++;
        }
      }

      // Build the insert row. mcq uses choices + answer_index; spr uses
      // correct_answer + answer_tolerance with placeholder choices/index
      // (the runner ignores them when response_format = 'spr'). Explicit
      // wider field types so the conditional doesn't get narrowed to one
      // branch's literal types by Supabase's insert type inference.
      const nowIso = new Date().toISOString();
      const row: {
        id: string;
        section: 'rw' | 'math';
        skill: string;
        passage: string | null;
        prompt: string;
        choices: string[];
        answer_index: number;
        explanation: string;
        source: string;
        response_format: 'mcq' | 'spr';
        correct_answer: string | null;
        answer_tolerance: number | null;
        dedup_hash: string;
        difficulty: 'easy' | 'medium' | 'hard';
        classified_at: string;
      } = q.responseFormat === 'mcq'
        ? {
            id: `ai-${randomUUID()}`,
            section: q.section,
            skill: q.skill,
            passage: q.passage ?? null,
            prompt: q.prompt,
            // If we repaired the choice list to remove an extra-valid
            // choice, insert the repaired set. answerIndex is unchanged
            // because the repair preserves the intended-answer slot.
            choices: repairedChoices ?? q.choices,
            answer_index: q.answerIndex,
            explanation: q.explanation,
            source: 'ai',
            response_format: 'mcq',
            correct_answer: null,
            answer_tolerance: null,
            // Dedup against the FINAL choice list — a repaired candidate
            // hashes differently from the original buggy version, which is
            // the right behavior (the bug version would've been rejected).
            dedup_hash: dedupHash(q.prompt, repairedChoices ?? q.choices, q.passage),
            difficulty: q.difficulty,
            classified_at: nowIso,
          }
        : {
            id: `ai-${randomUUID()}`,
            section: q.section,
            skill: q.skill,
            passage: null,
            prompt: q.prompt,
            choices: [],
            answer_index: 0,
            explanation: q.explanation,
            source: 'ai',
            response_format: 'spr',
            correct_answer: q.correctAnswer,
            answer_tolerance: q.answerTolerance ?? null,
            dedup_hash: dedupHash(q.prompt, [q.correctAnswer]),
            difficulty: q.difficulty,
            classified_at: nowIso,
          };

      const { error } = await admin.schema('sat').from('questions').insert(row);
      if (error) {
        if (error.code === '23505') summary.rejectedDuplicate++;
        else console.error('[generate] insert error', error);
        continue;
      }
      summary.accepted++;
    }
  }
  return summary;
}
