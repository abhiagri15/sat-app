import { getDailyAttemptLimit } from '@/app/lib/config';
import { setDailyAttemptLimit } from '@/app/lib/admin/actions';

// Admin settings. Under (app)/admin/layout.tsx, so requireAdmin() gates it.
export default async function AdminSettingsPage() {
  const limit = await getDailyAttemptLimit();

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
    </main>
  );
}
