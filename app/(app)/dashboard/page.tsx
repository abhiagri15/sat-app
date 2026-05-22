import Link from 'next/link';
import { getOrCreateProfile } from '@/app/lib/auth/profile';
import { listAttempts } from '@/app/lib/persistence/queries';
import { AttemptCard } from '@/app/components/AttemptCard';

export default async function DashboardPage() {
  const profile = await getOrCreateProfile();
  const attempts = await listAttempts();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-2xl font-bold">Your dashboard</h1>
      <p className="text-slate-600">
        Signed in as {profile?.full_name || profile?.email}.
      </p>

      {attempts.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-slate-600">You haven’t taken a test yet.</p>
          <Link href="/" className="mt-3 inline-block text-blue-600 underline">
            Take your first test
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <h2 className="text-sm font-semibold text-slate-500">Your test history</h2>
          {attempts.map((a) => (
            <AttemptCard key={a.id} attempt={a} />
          ))}
        </div>
      )}
    </main>
  );
}
