import Link from 'next/link';
import {
  PAGE_SIZE,
  buildUsersHref,
  type UsersSearchParams,
} from '@/app/lib/admin/users-search';

interface Props {
  current: UsersSearchParams;
  total: number;
}

// Hidden when total <= PAGE_SIZE (a single page of results doesn't need
// pagination chrome). Plain <Link>s — no JS, no client component needed.
export function UsersPagination({ current, total }: Props) {
  if (total <= PAGE_SIZE) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, current.page), totalPages);
  const firstRow = (page - 1) * PAGE_SIZE + 1;
  const lastRow  = Math.min(page * PAGE_SIZE, total);

  const prevHref = buildUsersHref({ ...current, page: page - 1 });
  const nextHref = buildUsersHref({ ...current, page: page + 1 });

  return (
    <div className="mt-6 flex items-center justify-between text-sm text-slate-600">
      <div>
        Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of{' '}
        {total.toLocaleString()}
      </div>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={prevHref}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            ‹ Prev
          </Link>
        ) : (
          <span className="rounded border border-slate-200 px-3 py-1 text-slate-300">
            ‹ Prev
          </span>
        )}
        <span className="text-slate-500">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={nextHref}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            Next ›
          </Link>
        ) : (
          <span className="rounded border border-slate-200 px-3 py-1 text-slate-300">
            Next ›
          </span>
        )}
      </div>
    </div>
  );
}
