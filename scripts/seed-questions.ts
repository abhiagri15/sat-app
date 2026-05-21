// One-time seed: upserts the in-code BANK into sat.questions.
// Run: pnpm dlx tsx --env-file=.env.local scripts/seed-questions.ts
import { createClient } from '@supabase/supabase-js';
import { BANK } from '../app/lib/questions';
import { dedupHash } from '../app/lib/ai/dedup';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const rows = BANK.map((q) => ({
  id: q.id,
  section: q.section,
  skill: q.skill,
  passage: q.passage ?? null,
  prompt: q.prompt,
  choices: q.choices,
  answer_index: q.answerIndex,
  explanation: q.explanation,
  source: 'seed' as const,
  dedup_hash: dedupHash(q.prompt, q.choices, q.passage),
}));

// Wrapped in an async IIFE — tsx transforms this script as CommonJS (the project
// package.json has no "type":"module"), which disallows top-level await.
void (async () => {
  const { error } = await admin
    .schema('sat')
    .from('questions')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('seed failed:', error);
    process.exit(1);
  }
  console.log(`seeded ${rows.length} questions into sat.questions`);
})().catch((e) => {
  console.error('seed failed:', e);
  process.exit(1);
});
