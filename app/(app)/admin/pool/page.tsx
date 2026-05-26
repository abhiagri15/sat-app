import { getGeneratorState } from '@/app/lib/admin/queries';
import { setNeverServedFloor } from '@/app/lib/admin/actions';
import { SKILLS } from '@/app/lib/questions';

// Admin pool composition view. Surfaces the same snapshot the question-
// generator uses on its next run, plus a control to set the floor that
// drives replenishment.
//
// The floor is PER SKILL and compares against worstStudentUnseen — the
// MIN, across active students, of that student's unseen count for the
// skill. So replenishment fires the moment ANY active student drops below
// floor for ANY skill.
//
// Within a picked skill the generator targets the thinnest DIFFICULTY cell
// (where the same metric is also lowest) so each skill grows balanced
// across easy/medium/hard for adaptive testing.
//
// sat.generator_state() omits skills/cells that have no enabled questions;
// we cross-product against canonical SKILLS x difficulties and default
// missing entries to 0 (every student has 0 unseen for an empty skill).

type Section = 'rw' | 'math';
type Difficulty = 'easy' | 'medium' | 'hard';

const SECTIONS: readonly Section[] = ['rw', 'math'] as const;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'] as const;
const SECTION_LABEL: Record<Section, string> = {
  rw: 'Reading & Writing',
  math: 'Math',
};

const WORST_LIMIT = 20;

function tone(value: number, floor: number): string {
  if (value >= floor) return 'text-emerald-700';
  if (value >= Math.ceil(floor / 2)) return 'text-amber-700';
  return 'text-rose-700';
}

interface SkillRow {
  section: Section;
  skill: string;
  worst: number; // worst student's unseen count across all difficulties
  easy: number; // worst student's unseen count for this cell
  medium: number;
  hard: number;
}

export default async function AdminPoolPage() {
  const state = await getGeneratorState();
  const { minActiveUserUnseen, neverServedFloor, bufferTarget } = state;

  const skillWorst = new Map<string, number>();
  for (const s of state.skills) {
    skillWorst.set(`${s.section}|${s.skill}`, s.worstStudentUnseen);
  }
  const cellWorst = new Map<string, number>();
  for (const c of state.cells) {
    cellWorst.set(`${c.section}|${c.skill}|${c.difficulty}`, c.worstStudentUnseen);
  }

  // One row per canonical skill, including ones absent from the RPC.
  const skills: SkillRow[] = [];
  for (const section of SECTIONS) {
    for (const skill of SKILLS[section]) {
      skills.push({
        section,
        skill,
        worst: skillWorst.get(`${section}|${skill}`) ?? 0,
        easy: cellWorst.get(`${section}|${skill}|easy`) ?? 0,
        medium: cellWorst.get(`${section}|${skill}|medium`) ?? 0,
        hard: cellWorst.get(`${section}|${skill}|hard`) ?? 0,
      });
    }
  }
  const totalSkills = skills.length;
  const belowFloorSkills = skills.filter((s) => s.worst < neverServedFloor).length;
  const emptySkills = skills.filter((s) => s.worst === 0).length;

  // Worst-N skills (lowest worst-student-unseen first) with stable tie-break.
  const worst = [...skills]
    .sort(
      (a, b) =>
        a.worst - b.worst ||
        a.section.localeCompare(b.section) ||
        a.skill.localeCompare(b.skill),
    )
    .slice(0, WORST_LIMIT);

  const bufferHealthy =
    typeof minActiveUserUnseen === 'number' && minActiveUserUnseen >= bufferTarget;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Question pool</h1>
      <p className="text-sm text-slate-500">
        Each number below is the count of <em>unseen questions for the
        worst-off student</em> in that scope. Replenishment fires when any
        skill drops below the floor for any active student.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs text-slate-500">
            Worst-off student unseen (overall)
          </div>
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
            <span className="ml-1 text-sm text-slate-400">per skill</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs text-slate-500">Skills below floor</div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              belowFloorSkills === 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {belowFloorSkills}
            <span className="ml-1 text-sm text-slate-400">/ {totalSkills}</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs text-slate-500">Skills with worst at 0</div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              emptySkills === 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {emptySkills}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-medium text-slate-700">
          Set per-skill floor
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Minimum unseen questions per skill that every active student must
          have. The next generator run will replenish any skill where ANY
          active student is below this number, targeting the thinnest
          difficulty within each skill.
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
          Worst {WORST_LIMIT} skills (lowest worst-student-unseen first)
        </h2>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Section</th>
                <th className="px-3 py-2 text-left">Skill</th>
                <th className="px-3 py-2 text-right">E</th>
                <th className="px-3 py-2 text-right">M</th>
                <th className="px-3 py-2 text-right">H</th>
                <th className="px-3 py-2 text-right">Worst</th>
              </tr>
            </thead>
            <tbody>
              {worst.map((s) => (
                <tr
                  key={`${s.section}|${s.skill}`}
                  className="border-t border-slate-100"
                >
                  <td className="px-3 py-2 text-slate-700">
                    {SECTION_LABEL[s.section]}
                  </td>
                  <td className="px-3 py-2 text-slate-900">{s.skill}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                    {s.easy}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                    {s.medium}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                    {s.hard}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${tone(s.worst, neverServedFloor)}`}
                  >
                    {s.worst}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Each cell is the unseen count for the student with the FEWEST unseen
          questions in that scope. &ldquo;Worst&rdquo; is the per-skill
          aggregate the gate compares against the floor.{' '}
          {DIFFICULTIES.join(', ')} per skill so you can see which difficulty
          cell the picker will target next.
        </p>
      </section>
    </main>
  );
}
