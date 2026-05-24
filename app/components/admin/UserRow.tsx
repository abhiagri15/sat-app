import Link from 'next/link';
import type { AdminUserRow } from '@/app/lib/admin/users';

// One row in the /admin/users list. The whole row links to /admin/users/[id]
// for the per-user analytics drill-down. Falls back gracefully when fields
// are null (a user who has never submitted a test has no avg score / last
// activity; a Google sign-up without a display name shows their email).
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  // Same format as the rest of the app: short ISO yyyy-mm-dd
  return iso.slice(0, 10);
}

function displayName(user: AdminUserRow): string {
  if (user.full_name && user.full_name.trim().length > 0) return user.full_name;
  if (user.email && user.email.trim().length > 0) return user.email;
  return `User ${user.id.slice(0, 8)}`;
}

export function UserRow({ user }: { user: AdminUserRow }) {
  const name = displayName(user);
  const showEmailSubline = !!user.full_name && !!user.email;

  return (
    <Link
      href={`/admin/users/${user.id}`}
      className="block rounded-lg border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-slate-900">{name}</span>
            {user.role === 'admin' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                admin
              </span>
            )}
          </div>
          {showEmailSubline && (
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {user.email}
            </div>
          )}
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-4 text-right text-xs text-slate-600">
          <div>
            <div className="text-base font-semibold text-slate-900">
              {user.tests_taken}
            </div>
            <div>tests</div>
          </div>
          <div>
            <div className="text-base font-semibold text-slate-900">
              {user.avg_scaled_score ?? '—'}
            </div>
            <div>avg score</div>
          </div>
          <div>
            <div className="text-base font-semibold text-slate-900">
              {formatDate(user.last_activity)}
            </div>
            <div>last active</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
