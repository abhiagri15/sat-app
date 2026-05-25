import { getDailyAttemptLimit, getModule2Thresholds } from '@/app/lib/config';
import { setDailyAttemptLimit, setModule2Thresholds } from '@/app/lib/admin/actions';

// Admin settings. Under (app)/admin/layout.tsx, so requireAdmin() gates it.
export default async function AdminSettingsPage() {
  const limit = await getDailyAttemptLimit();
  const thresholds = await getModule2Thresholds();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Settings</h1>
      <p className="text-sm text-slate-500">App-wide configuration.</p>

      <form
        action={setDailyAttemptLimit}
        className="mt-6 rounded-lg border border-slate-200 p-4"
      >
        <label
          htmlFor="limit"
          className="block text-sm font-medium text-slate-700"
        >
          Daily test limit per user
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          How many tests one user can submit per day (UTC). Set to 0 to pause
          testing for everyone.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="limit"
            name="limit"
            type="number"
            min={0}
            max={100}
            defaultValue={limit}
            required
            className="w-24 rounded border border-slate-300 p-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </form>

      <form
        action={setModule2Thresholds}
        className="mt-4 rounded-lg border border-slate-200 p-4"
      >
        <h2 className="text-sm font-medium text-slate-700">
          Adaptive Module 2 routing thresholds
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Percent correct on Module 1 required to take the Harder Module 2.
          Below this threshold the student takes the Easier path. Per-section
          so R&amp;W and Math can be tuned independently.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-xs text-slate-600">
            <span>Reading &amp; Writing threshold (%)</span>
            <input
              name="rw_threshold"
              type="number"
              min={0}
              max={100}
              defaultValue={thresholds.rw}
              required
              className="mt-1 w-24 rounded border border-slate-300 p-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            <span>Math threshold (%)</span>
            <input
              name="math_threshold"
              type="number"
              min={0}
              max={100}
              defaultValue={thresholds.math}
              required
              className="mt-1 w-24 rounded border border-slate-300 p-1.5 text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Save thresholds
        </button>
      </form>
    </main>
  );
}
