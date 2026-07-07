/* One-off smoke: retry figure-bearing generation until a batch lands. Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/smoke-figure-gen.ts
 */
import { generateBatchForSkill } from '../app/lib/ai/generate';

async function main() {
  for (let i = 1; i <= 3; i++) {
    const t = Date.now();
    const b = await generateBatchForSkill('math', 'Scatterplots & Models', 2, 'medium');
    console.log(`run ${i}: ${JSON.stringify(b)} in ${Math.round((Date.now() - t) / 1000)}s`);
    if (b.accepted > 0) return;
  }
  process.exit(1);
}

main();
