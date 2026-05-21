// Placeholder dashboard route. The Auth sub-project (#3) replaces this content
// with a signed-in history view. Persistence sub-project (#4) wires the data.
// The Supabase smoke test is added in Task 8 and removed when Auth lands.
export default function DashboardPage() {
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
