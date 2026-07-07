/* One-off: exercise the updated generation prompt against Ollama Cloud and
 * print candidates for review. Not part of the app. Run:
 *   npx tsx scripts/sample-gen.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env.local into process.env (standalone scripts don't get Next's loader).
for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { OllamaCloudProvider } from '../app/lib/ai/ollama';

type Diff = 'easy' | 'medium' | 'hard';
const provider = new OllamaCloudProvider();

const rwTargets: [string, Diff][] = [
  ['Rhetorical Synthesis', 'medium'],
  ['Boundaries (Punctuation)', 'medium'],
  ['Pronoun Agreement', 'medium'],
  ['Words in Context', 'hard'],
  ['Inferences', 'medium'],
];

async function main() {
  for (const [skill, diff] of rwTargets) {
    try {
      const qs = await provider.generateQuestions('rw', skill, 1, false, diff);
      console.log(`\n===== RW / ${skill} / ${diff} =====`);
      console.log(JSON.stringify(qs, null, 2));
    } catch (e) {
      console.log(`\n===== RW / ${skill} / ${diff} ===== ERROR: ${(e as Error).message}`);
    }
  }
  // Grid-in (SPR) math — the format that never landed in the live pool.
  try {
    const qs = await provider.generateQuestions('math', 'Linear Equations', 2, true, 'medium');
    console.log(`\n===== MATH (SPR) / Linear Equations / medium =====`);
    console.log(JSON.stringify(qs, null, 2));
  } catch (e) {
    console.log(`\n===== MATH (SPR) ===== ERROR: ${(e as Error).message}`);
  }
}

main();
