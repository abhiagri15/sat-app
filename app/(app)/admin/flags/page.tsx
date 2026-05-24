import Link from 'next/link';
import { listFlags, type FlagStatus } from '@/app/lib/admin/flags';
import { FlagRow } from '@/app/components/admin/FlagRow';

const STATUS_FILTERS: { label: string; status: FlagStatus | 'all' }[] = [
  { label: 'Open', status: 'open' },
  { label: 'Resolved', status: 'resolved' },
  { label: 'All', status: 'all' },
];

export default async function AdminFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status: FlagStatus | 'all' =
    sp.status === 'resolved' || sp.status === 'all' ? sp.status : 'open';
  const flags = await listFlags(status);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Question flags</h1>
      <p className="text-sm text-slate-500">
        User-reported problems with pool questions.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.status}
            href={f.status === 'open' ? '/admin/flags' : `/admin/flags?status=${f.status}`}
            className={`rounded-full px-3 py-1 text-xs ${
              status === f.status
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="mt-6 space-y-2">
        {flags.length === 0 ? (
          <p className="text-sm text-slate-500">No flags here.</p>
        ) : (
          flags.map((f) => <FlagRow key={f.id} flag={f} />)
        )}
      </div>
    </main>
  );
}
