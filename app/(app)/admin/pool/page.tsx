import { getGeneratorState } from '@/app/lib/admin/queries';
import { setNeverServedFloor } from '@/app/lib/admin/actions';

// Admin pool composition view. Surfaces the same snapshot the question-
// generator uses on its next run, plus a control to set the never-served
// floor that drives replenishment.
//
// Three blocks:
//   - Status line: minActiveUserUnseen vs. bufferTarget, current floor.
//   - Composition (section x difficulty, 6 cells): summed never-served
//     across all skills in that bucket. Quick at-a-glance balance check.
//   - Worst 10 (section, skill, difficulty) triples: the thinnest cells —
//     these are what the picker targets on the next run.

type Section = 'rw' | 'math';
type Difficulty = 'easy' | 'medium' | 'hard';

const SECTIONS: readonly Section[] = ['rw', 'math'] as const;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'] as const;
const SECTION_LABEL: Record<Section, string> = {
  rw: 'Reading & Writing',
  math: 'Math',
};

function difficultyClass(neverServed: number, floor: number): string {
  if (neverServed >= floor) return 'text-emerald-700';
  if (neverServed >= Math.ceil(floor / 2)) return 'text-amber-700';
  return 'text-rose-700';
}

export default async function AdminPoolPage() {
  const state = await getGeneratorState();
  const { minActiveUserUnseen, neverServedFloor, bufferTarget, cells } = state;

  // Sum never-served by (section, difficulty) for the 6-cell composition
  // table. Cells the RPC omits (neverServed == 0) just don't add anything.
  const composition = new Map<string, number>();
  for (const c of cells) {
    const key = `${c.section}|${c.difficulty}`;
    composition.set(key, (composition.get(key) ?? 0) + c.neverServed);
  }

  // Below-floor triples first (thinnest first), then a long tail capped at
  // the worst 10 — that's what the picker would touch on the next run.
  const worst = [...cells].sort((a, b) => a.neverServed - b.neverServed).slice(0, 10);
  const belowFloorCount = cells.filter((c) => c.neverServed < neverServedFloor).length;
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

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          Worst {worst.length} cells (thinnest first)
        </h2>
        {worst.length === 0 ? (
          <p className="text-sm text-slate-500">
            Every cell is fully stocked at zero. Either the pool is unbuilt or
            every question has been served at least once.
          </p>
        ) : (
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
                      className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${difficultyClass(c.neverServed, neverServedFloor)}`}
                    >
                      {c.neverServed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Cells with a never-served count of zero are not listed; they show as
          missing rows when fully exhausted.
        </p>
      </section>
    </main>
  );
}
