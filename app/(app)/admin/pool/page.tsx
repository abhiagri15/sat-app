import { getGeneratorState } from '@/app/lib/admin/queries';
import { setNeverServedFloor } from '@/app/lib/admin/actions';
import { SKILLS } from '@/app/lib/questions';

// Admin pool composition view. Surfaces the same snapshot the question-
// generator uses on its next run, plus a control to set the never-served
// floor that drives replenishment.
//
// Three blocks:
//   - Status line: minActiveUserUnseen vs. bufferTarget, current floor.
//   - Composition (section x difficulty, 6 cells): summed never-served
//     across all skills in that bucket. Quick at-a-glance balance check.
//   - Worst N (section, skill, difficulty) triples: the thinnest cells —
//     these are what the picker targets on the next run.
//
// Important: sat.generator_state() only returns cells that have at least
// one never-served question. Cells with ZERO never-served are missing from
// the RPC payload. To get an accurate "cells below floor" count and a
// proper worst-N list, we cross-product the canonical SKILLS x difficulties
// and fill missing cells with 0 — exactly the same pattern the generator's
// Plan Batches uses.

type Section = 'rw' | 'math';
type Difficulty = 'easy' | 'medium' | 'hard';

const SECTIONS: readonly Section[] = ['rw', 'math'] as const;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'] as const;
const SECTION_LABEL: Record<Section, string> = {
  rw: 'Reading & Writing',
  math: 'Math',
};

// Show this many worst cells. Bumped above 10 because empty cells are now
// included — and there are usually a fair number of skill-difficulty cells
// at zero before the generator catches up.
const WORST_LIMIT = 20;

function tone(neverServed: number, floor: number): string {
  if (neverServed >= floor) return 'text-emerald-700';
  if (neverServed >= Math.ceil(floor / 2)) return 'text-amber-700';
  return 'text-rose-700';
}

interface Cell {
  section: Section;
  skill: string;
  difficulty: Difficulty;
  neverServed: number;
}

export default async function AdminPoolPage() {
  const state = await getGeneratorState();
  const { minActiveUserUnseen, neverServedFloor, bufferTarget } = state;

  // Build a lookup of (section, skill, difficulty) -> neverServed from the
  // RPC. Cells not present default to 0 below.
  const rpcCounts = new Map<string, number>();
  for (const c of state.cells) {
    rpcCounts.set(`${c.section}|${c.skill}|${c.difficulty}`, c.neverServed);
  }

  // The full grid: every section x skill x difficulty triple, with zeros
  // filled in for cells the RPC omitted.
  const allCells: Cell[] = [];
  for (const section of SECTIONS) {
    for (const skill of SKILLS[section]) {
      for (const difficulty of DIFFICULTIES) {
        allCells.push({
          section,
          skill,
          difficulty,
          neverServed: rpcCounts.get(`${section}|${skill}|${difficulty}`) ?? 0,
        });
      }
    }
  }
  const totalCells = allCells.length;

  // Composition sum by (section, difficulty) from the full grid (zero cells
  // contribute zero, so the math is identical — but a missing skill no
  // longer artificially deflates the bucket above the floor).
  const composition = new Map<string, number>();
  for (const c of allCells) {
    const key = `${c.section}|${c.difficulty}`;
    composition.set(key, (composition.get(key) ?? 0) + c.neverServed);
  }

  // Worst-N thinnest cells. Stable tie-break by section then skill then
  // difficulty so refreshes don't jiggle the list.
  const worst = [...allCells]
    .sort(
      (a, b) =>
        a.neverServed - b.neverServed ||
        a.section.localeCompare(b.section) ||
        a.skill.localeCompare(b.skill) ||
        a.difficulty.localeCompare(b.difficulty),
    )
    .slice(0, WORST_LIMIT);

  const belowFloorCount = allCells.filter((c) => c.neverServed < neverServedFloor).length;
  const emptyCellCount = allCells.filter((c) => c.neverServed === 0).length;
  const bufferHealthy =
    typeof minActiveUserUnseen === 'number' && minActiveUserUnseen >= bufferTarget;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Question pool</h1>
      <p className="text-sm text-slate-500">
        Composition the generator sees on its next run. Replenishment fires
        whenever any (section, skill, difficulty) cell has fewer than the
        floor of never-served questions.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs text-slate-500">Worst-off student unseen</div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              bufferHealthy ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {minActiveUserUnseen ?? '—'}
            <span className="ml-1 text-sm text-slate-400">/ {bufferTarget}</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs text-slate-500">Never-served floor</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {neverServedFloor}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs text-slate-500">Cells below floor</div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              belowFloorCount === 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {belowFloorCount}
            <span className="ml-1 text-sm text-slate-400">/ {totalCells}</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs text-slate-500">Empty cells (zero fresh)</div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              emptyCellCount === 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {emptyCellCount}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-medium text-slate-700">
          Set never-served floor
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Minimum never-served questions per (section, skill, difficulty)
          cell. The next generator run will replenish any cell that falls
          below this number.
        </p>
        <form action={setNeverServedFloor} className="mt-2 flex items-center gap-2">
          <input
            id="floor"
            name="floor"
            type="number"
            min={1}
            max={100}
            defaultValue={neverServedFloor}
            required
            className="w-24 rounded border border-slate-300 p-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Save floor
          </button>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-slate-700">
          Composition (section × difficulty)
        </h2>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Section</th>
                {DIFFICULTIES.map((d) => (
                  <th key={d} className="px-3 py-2 text-right">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => (
                <tr key={section} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {SECTION_LABEL[section]}
                  </td>
                  {DIFFICULTIES.map((d) => {
                    const sum = composition.get(`${section}|${d}`) ?? 0;
                    return (
                      <td
                        key={d}
                        className="px-3 py-2 text-right font-mono tabular-nums text-slate-700"
                      >
                        {sum}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Total never-served questions across all skills in each
          (section, difficulty) bucket.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-slate-700">
          Worst {WORST_LIMIT} cells (thinnest first)
        </h2>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Section</th>
                <th className="px-3 py-2 text-left">Skill</th>
                <th className="px-3 py-2 text-left">Difficulty</th>
                <th className="px-3 py-2 text-right">Never-served</th>
              </tr>
            </thead>
            <tbody>
              {worst.map((c) => (
                <tr
                  key={`${c.section}|${c.skill}|${c.difficulty}`}
                  className="border-t border-slate-100"
                >
                  <td className="px-3 py-2 text-slate-700">
                    {SECTION_LABEL[c.section]}
                  </td>
                  <td className="px-3 py-2 text-slate-900">{c.skill}</td>
                  <td className="px-3 py-2 text-slate-700">{c.difficulty}</td>
                  <td
                    className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${tone(c.neverServed, neverServedFloor)}`}
                  >
                    {c.neverServed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Empty cells (zero never-served) are now included — these are what
          the generator targets first on its next run.
        </p>
      </section>
    </main>
  );
}
