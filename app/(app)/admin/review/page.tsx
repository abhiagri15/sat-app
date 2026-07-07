import Link from 'next/link';
import {
  getReviewQueue,
  type ReviewQueueRow,
  type ReviewReason,
} from '@/app/lib/admin/queries';

// Admin needs-review queue (design spec §D). The admin layout gates this route
// (requireAdmin() 404s non-admins), so this page just renders the computed
// queue. Each row links to /admin/questions/[id] where the disable toggle and
// item stats live. Empty state when nothing qualifies (also the graceful
// degradation path when the RPC isn't migrated yet — getReviewQueue returns []).

function excerpt(s: string, n = 90): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// One reason chip per fired reason. 'flagged' collapses the open-flags count
// into "Flagged ×N" (amber); the two calibration reasons render fixed labels.
function ReasonChips({ row }: { row: ReviewQueueRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {row.reasons.map((reason: ReviewReason) => {
        if (reason === 'flagged') {
          return (
            <span
              key={reason}
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
            >
              Flagged ×{row.open_flags}
            </span>
          );
        }
        if (reason === 'very-hard-suspect') {
          return (
            <span
              key={reason}
              className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
            >
              Suspect: too hard
            </span>
          );
        }
        // 'too-easy'
        return (
          <span
            key={reason}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
          >
            Too easy
          </span>
        );
      })}
    </div>
  );
}

export default async function AdminReviewPage() {
  const queue = await getReviewQueue();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Needs review</h1>
      <p className="text-sm text-slate-500">
        Item-quality anomalies: heavily flagged, or pathologically hard/easy over
        enough responses. This is a computed queue — no lifecycle state.
      </p>

      <div className="mt-6 space-y-2">
        {queue.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing needs review.</p>
        ) : (
          queue.map((row) => (
            <Link
              key={row.question_id}
              href={`/admin/questions/${row.question_id}`}
              className="block rounded-lg border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                  {row.section === 'rw' ? 'R&W' : 'Math'}
                </span>
                <span className="text-slate-600">{row.skill}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                  {row.difficulty}
                </span>
                <ReasonChips row={row} />
              </div>
              <p className="mt-2 text-sm text-slate-800">{excerpt(row.prompt)}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                <span>n = {row.n}</span>
                <span>
                  p ={' '}
                  {row.p_value == null ? '—' : row.p_value.toFixed(2)}
                </span>
                <span>open flags: {row.open_flags}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
