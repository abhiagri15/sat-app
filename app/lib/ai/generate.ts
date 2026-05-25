import { randomUUID } from 'crypto';
import { getProvider } from './provider';
import { generatedQuestionSchema } from './schema';
import { dedupHash } from './dedup';
import { SKILLS } from '@/app/lib/questions';
import { isSprCorrect } from '@/app/lib/spr';
import { createAdminClient } from '@/app/lib/supabase/admin';

// Keep at least this many UNSEEN questions in the pool for the worst-off
// active student. A run only generates while the worst-case student's
// unseen count is below this — otherwise it is a fast no-op.
//
// "Worst-off active student" = the user with the smallest unseen count among
// those who have submitted ≥ 1 test attempt. Computed by the SQL function
// sat.min_active_user_unseen(). This keeps existing questions usable for
// every student before new ones are generated — a new student logging in
// gets the full pool fresh, even if it has been served to others.
//
// (Earlier this gated on the globally-never-served count, which over-fires
// the generator: a question served only to Dhruv looked "used" even though
// every other student still had it ahead of them.)
const BUFFER_TARGET = 100;
// Minimum enabled questions per (section, skill) slot. The gate fires
// generation even when the per-user buffer is healthy if any slot is below
// this floor — so newly-added skills auto-populate via the thinnest-first
// picker without a manual backfill. Set to perRun so one batch fills a fresh
// slot to the floor.
const SKILL_FLOOR = 3;
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
  bufferTarget: number;        // BUFFER_TARGET — generation runs only below this
  generated: number;
  accepted: number;
  rejectedSchema: number;
  rejectedSelfVerify: number;
  rejectedDuplicate: number;
}

interface QuestionRow {
  id: string;
  section: 'rw' | 'math';
  skill: string;
  enabled: boolean;
  difficulty: 'easy' | 'medium' | 'hard';
}

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'] as const;

export async function runGeneration(): Promise<GenerationSummary> {
  const admin = createAdminClient();
  const summary: GenerationSummary = {
    minUnseenBefore: null,
    bufferTarget: BUFFER_TARGET,
    generated: 0,
    accepted: 0,
    rejectedSchema: 0,
    rejectedSelfVerify: 0,
    rejectedDuplicate: 0,
  };

  // 1. Per-user gate (cheap RPC). The function returns the smallest unseen-
  //    enabled-questions count across active students (those with ≥ 1 attempt).
  //    null = nobody using the app yet — no demand, hard skip. A number is the
  //    worst-off student's unseen count; combined with the floor check below
  //    it decides whether to generate.
  const { data: minUnseen, error: minError } = await admin
    .schema('sat')
    .rpc('min_active_user_unseen');
  if (minError) throw minError;
  summary.minUnseenBefore = (minUnseen ?? null) as number | null;
  if (minUnseen === null) {
    return summary; // no active students yet — nothing to do
  }

  // 2. Load the enabled pool. We need it for both the floor gate and the
  //    thinnest-first picker, so load once and share.
  const { data: qData, error: qError } = await admin
    .schema('sat')
    .from('questions')
    .select('id, section, skill, enabled, difficulty');
  if (qError) throw qError;
  const questions = (qData ?? []) as unknown as QuestionRow[];
  const enabled = questions.filter((q) => q.enabled);

  // 3. Compute depth per (section, skill, difficulty) — feeds both gates and
  //    the picker. Sub-project #11 made the floor per difficulty cell so a
  //    new skill needs SKILL_FLOOR easy + medium + hard before the floor stops
  //    firing.
  const depth = new Map<string, number>();
  for (const q of enabled) {
    const key = `${q.section}|${q.skill}|${q.difficulty}`;
    depth.set(key, (depth.get(key) ?? 0) + 1);
  }
  const belowFloor = (['rw', 'math'] as const).some((section) =>
    SKILLS[section].some((skill) =>
      DIFFICULTIES.some(
        (diff) => (depth.get(`${section}|${skill}|${diff}`) ?? 0) < SKILL_FLOOR,
      ),
    ),
  );

  // 4. Dual gate: skip iff the per-user buffer is healthy AND every cell is
  //    at or above the floor. Either condition failing keeps the run going.
  const bufferHealthy = (minUnseen as number) >= BUFFER_TARGET;
  if (bufferHealthy && !belowFloor) {
    return summary;
  }

  // 5. Pick the thinnest (section, skill, difficulty) triples.
  const slots: {
    section: 'rw' | 'math';
    skill: string;
    difficulty: Difficulty;
    have: number;
  }[] = [];
  for (const section of ['rw', 'math'] as const) {
    for (const skill of SKILLS[section]) {
      for (const difficulty of DIFFICULTIES) {
        slots.push({
          section,
          skill,
          difficulty,
          have: depth.get(`${section}|${skill}|${difficulty}`) ?? 0,
        });
      }
    }
  }
  const targets = slots
    .sort((a, b) => a.have - b.have)
    .slice(0, MAX_SKILLS_PER_RUN);

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
            choices: q.choices,
            answer_index: q.answerIndex,
            explanation: q.explanation,
            source: 'ai',
            response_format: 'mcq',
            correct_answer: null,
            answer_tolerance: null,
            dedup_hash: dedupHash(q.prompt, q.choices, q.passage),
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
