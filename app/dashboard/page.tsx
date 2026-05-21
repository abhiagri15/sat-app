import { createClient } from '@/app/lib/supabase/server';

export default async function DashboardPage() {
  // Foundation smoke test: prove SSR + cookies + connection work end-to-end.
  // Uses auth.getSession() because PostgREST does not expose pg_catalog/system tables,
  // and we have no application tables yet (sat schema is empty). getSession() with no
  // active session returns { data: { session: null }, error: null } — a "success" outcome
  // that exercises the full cookie+SSR+HTTPS path.
  // Removed by the Auth sub-project (#3) when real session reads land.
  const supabase = await createClient();
  const { error } = await supabase.auth.getSession();
  console.log('[Foundation smoke]', error ? `error: ${error.message}` : 'connected');

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-bold mb-2">Your dashboard</h1>
      <p className="text-slate-600">
        Sign in to see your test history, scores over time, and per-skill progress.
      </p>
      <p className="mt-4 text-sm text-slate-500">
        Sign-in arrives in the next sub-project — for now this is a placeholder.
      </p>
    </main>
  );
}
