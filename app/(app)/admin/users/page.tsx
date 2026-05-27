import Link from 'next/link';
import { searchUsers, getUsersStats } from '@/app/lib/admin/users';
import { parseUsersSearchParams } from '@/app/lib/admin/users-search';
import { UserRow } from '@/app/components/admin/UserRow';
import { UsersToolbar } from '@/app/components/admin/UsersToolbar';
import { UsersPagination } from '@/app/components/admin/UsersPagination';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Admin users page. Gated by the /admin layout's requireAdmin(); both the
// admin_users_search and admin_users_stats RPCs re-check role at the SQL
// layer (defense in depth).
export default async function AdminUsersPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const params = parseUsersSearchParams(rawParams);

  // Filter-independent headline + filtered page in parallel.
  const [stats, { rows, total }] = await Promise.all([
    getUsersStats(),
    searchUsers(params),
  ]);

  const isFilteredOrSearching =
    params.q !== '' ||
    params.role !== 'all' ||
    params.activity !== 'all' ||
    params.joined !== 'all' ||
    params.score !== 'all' ||
    params.page > 1;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Users</h1>
      <p className="text-sm text-slate-500">
        {stats.total.toLocaleString()} total ·{' '}
        {stats.students.toLocaleString()} student{stats.students === 1 ? '' : 's'} ·{' '}
        {stats.admins.toLocaleString()} admin{stats.admins === 1 ? '' : 's'} ·{' '}
        {stats.active.toLocaleString()} active (30d) ·{' '}
        {stats.active_7d.toLocaleString()} active (7d)
      </p>

      <UsersToolbar current={params} />

      <div className="mt-6 space-y-2">
        {rows.length === 0 ? (
          isFilteredOrSearching ? (
            <p className="text-sm text-slate-500">
              No users match these filters.{' '}
              <Link href="/admin/users" className="font-medium text-blue-700 hover:underline">
                Clear filters
              </Link>
            </p>
          ) : (
            <p className="text-sm text-slate-500">No users yet.</p>
          )
        ) : (
          rows.map((u) => <UserRow key={u.id} user={u} />)
        )}
      </div>

      <UsersPagination current={params} total={total} />
    </main>
  );
}
