/* One-off smoke: force wantFigure=true at the provider and prove the model
 * emits a figure spec that passes generatedQuestionSchema + figureSchema. Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/smoke-figure-emit.ts
 */
import { getProvider } from '../app/lib/ai/provider';
import { generatedQuestionSchema } from '../app/lib/ai/schema';
import { figureSchema, describeFigure } from '../app/lib/ai/figure-schema';

async function main() {
  const provider = getProvider();
  for (let i = 1; i <= 3; i++) {
    try {
      const t = Date.now();
      const candidates = await provider.generateQuestions(
        'math', 'Scatterplots & Models', 2, false, 'medium', true,
      );
      const secs = Math.round((Date.now() - t) / 1000);
      let withFigure = 0;
      for (const c of candidates) {
        const parsed = generatedQuestionSchema.safeParse(c);
        if (!parsed.success) continue;
        if (parsed.data.figure) {
          const fig = figureSchema.safeParse(parsed.data.figure);
          if (fig.success) {
            withFigure += 1;
            console.log(`  valid figure: kind=${fig.data.kind}`);
            console.log(`  describeFigure: ${describeFigure(fig.data).slice(0, 140)}...`);
          }
        }
      }
      console.log(`run ${i}: ${candidates.length} candidates, ${withFigure} with valid figures, in ${secs}s`);
      if (withFigure > 0) return;
    } catch (e) {
      console.log(`run ${i}: ERROR ${(e as Error).message.slice(0, 120)}`);
    }
  }
  process.exit(1);
}

main();
