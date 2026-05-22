import { randomUUID } from 'crypto';
import { getProvider } from './provider';
import { generatedQuestionSchema } from './schema';
import { dedupHash } from './dedup';
import { SKILLS } from '@/app/lib/questions';
import { createAdminClient } from '@/app/lib/supabase/admin';

const TARGET_PER_SKILL = 20;   // desired pool depth per (section, skill)
// Bounded per invocation to fit the serverless time budget. Each Ollama call
// (~20-30s for DeepSeek) is slow: 1 skill x batch 2 = 1 generate + up to 2
// self-verify calls. Survivors are inserted incrementally, so a run cut short
// still grows the pool; raise these only with a larger `maxDuration`.
const MAX_SKILLS_PER_RUN = 1;
const PER_SKILL_BATCH = 2;

export interface GenerationSummary {
  generated: number;
  accepted: number;
  rejectedSchema: number;
  rejectedSelfVerify: number;
  rejectedDuplicate: number;
}

export async function runGeneration(): Promise<GenerationSummary> {
  const admin = createAdminClient();
  const provider = getProvider();
  const summary: GenerationSummary = {
    generated: 0, accepted: 0, rejectedSchema: 0, rejectedSelfVerify: 0, rejectedDuplicate: 0,
  };

  // 1. current pool depth per (section, skill). Fail loud on a DB error —
  //    otherwise every skill would look empty and we'd over-generate.
  const { data: rows, error: depthError } = await admin
    .schema('sat')
    .from('questions')
    .select('section, skill');
  if (depthError) throw depthError;
  const depth = new Map<string, number>();
  for (const r of rows ?? []) {
    const key = `${r.section}|${r.skill}`;
    depth.set(key, (depth.get(key) ?? 0) + 1);
  }

  // 2. pick the most-depleted (section, skill) slots
  const slots: { section: 'rw' | 'math'; skill: string; have: number }[] = [];
  for (const section of ['rw', 'math'] as const) {
    for (const skill of SKILLS[section]) {
      slots.push({ section, skill, have: depth.get(`${section}|${skill}`) ?? 0 });
    }
  }
  const targets = slots
    .filter((s) => s.have < TARGET_PER_SKILL)
    .sort((a, b) => a.have - b.have)
    .slice(0, MAX_SKILLS_PER_RUN);

  // 3. generate, gate, insert
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
