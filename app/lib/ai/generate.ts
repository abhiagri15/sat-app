import { randomUUID } from 'crypto';
import { getProvider } from './provider';
import { generatedQuestionSchema } from './schema';
import { dedupHash } from './dedup';
import { SKILLS } from '@/app/lib/questions';
import { createAdminClient } from '@/app/lib/supabase/admin';

// Keep at least this many never-attempted questions in the pool. A run only
// generates while the count is below this — otherwise it is a fast no-op.
// "Never attempted" = an enabled question with no sat.served_questions row
// (draw_questions records a question as served the moment it hands it into a
// test). The hourly cron tops the buffer back up over successive runs.
const BUFFER_TARGET = 100;
// Bounded per invocation to fit the serverless time budget. Each Ollama call
// (~30-60s for DeepSeek) is slow: 1 skill x batch 3 = 1 generate + up to 3
// self-verify calls (~4 calls, within maxDuration=300s). Survivors are inserted
// incrementally, so a run cut short still grows the pool. Raise these only
// alongside a larger `maxDuration` on the generation route.
const MAX_SKILLS_PER_RUN = 1;
const PER_SKILL_BATCH = 3;

export interface GenerationSummary {
  unattemptedBefore: number;   // never-attempted pool count at the start of the run
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
}

export async function runGeneration(): Promise<GenerationSummary> {
  const admin = createAdminClient();
  const summary: GenerationSummary = {
    unattemptedBefore: 0,
    bufferTarget: BUFFER_TARGET,
    generated: 0,
    accepted: 0,
    rejectedSchema: 0,
    rejectedSelfVerify: 0,
    rejectedDuplicate: 0,
  };

  // 1. load the enabled pool and the serve history. Fail loud on a DB error —
  //    otherwise the buffer would look empty and we'd over-generate.
  const { data: qData, error: qError } = await admin
    .schema('sat')
    .from('questions')
    .select('id, section, skill, enabled');
  if (qError) throw qError;
  const { data: sData, error: sError } = await admin
    .schema('sat')
    .from('served_questions')
    .select('question_id');
  if (sError) throw sError;

  const questions = (qData ?? []) as unknown as QuestionRow[];
  const served = new Set(
    ((sData ?? []) as unknown as { question_id: string }[]).map((r) => r.question_id),
  );
  const enabled = questions.filter((q) => q.enabled);

  // 2. demand-driven: only generate while the never-attempted buffer is low.
  const unattempted = enabled.filter((q) => !served.has(q.id)).length;
  summary.unattemptedBefore = unattempted;
  if (unattempted >= BUFFER_TARGET) {
    return summary; // buffer healthy — nothing to generate this run
  }

  // 3. pick the thinnest (section, skill) slots, so topic coverage stays even
  //    as the hourly runs refill the buffer.
  const depth = new Map<string, number>();
  for (const q of enabled) {
    const key = `${q.section}|${q.skill}`;
    depth.set(key, (depth.get(key) ?? 0) + 1);
  }
  const slots: { section: 'rw' | 'math'; skill: string; have: number }[] = [];
  for (const section of ['rw', 'math'] as const) {
    for (const skill of SKILLS[section]) {
      slots.push({ section, skill, have: depth.get(`${section}|${skill}`) ?? 0 });
    }
  }
  const targets = slots
    .sort((a, b) => a.have - b.have)
    .slice(0, MAX_SKILLS_PER_RUN);

  // 4. generate, gate, insert
  const provider = getProvider();
  for (const t of targets) {
    let candidates;
    try {
      candidates = await provider.generateQuestions(t.section, t.skill, PER_SKILL_BATCH);
    } catch (e) {
      console.error('[generate] provider error', t.section, t.skill, e);
      continue;
    }
    for (const candidate of candidates) {
      summary.generated++;
      const parsed = generatedQuestionSchema.safeParse(candidate);
      if (!parsed.success) { summary.rejectedSchema++; continue; }
      const q = parsed.data;
      // Pin section/skill to what we requested — reject a question the model
      // mis-tagged (it keeps the SKILLS taxonomy and depth-balancing honest).
      if (q.section !== t.section || q.skill !== t.skill) {
        summary.rejectedSchema++;
        continue;
      }

      let solved: number;
      try { solved = await provider.solve(q); }
      catch (e) { console.error('[generate] solve error', e); summary.rejectedSelfVerify++; continue; }
      if (solved !== q.answerIndex) { summary.rejectedSelfVerify++; continue; }

      const { error } = await admin.schema('sat').from('questions').insert({
        id: `ai-${randomUUID()}`,
        section: q.section,
        skill: q.skill,
        passage: q.passage ?? null,
        prompt: q.prompt,
        choices: q.choices,
        answer_index: q.answerIndex,
        explanation: q.explanation,
        source: 'ai',
        dedup_hash: dedupHash(q.prompt, q.choices, q.passage),
      });
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
