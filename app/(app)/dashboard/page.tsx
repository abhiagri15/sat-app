import { getOrCreateProfile } from '@/app/lib/auth/profile';

export default async function DashboardPage() {
  const profile = await getOrCreateProfile();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-2xl font-bold">Your dashboard</h1>
      <p className="text-slate-600">
        Signed in as {profile?.full_name || profile?.email}.
      </p>
      <p className="mt-4 text-sm text-slate-500">
        Your test history and score trends will appear here once the
        Persistence sub-project lands.
      </p>
    </main>
  );
}
