import { listUsersWithStats } from '@/app/lib/admin/users';
import { UserRow } from '@/app/components/admin/UserRow';

// Admin users page. Gated by the /admin layout's requireAdmin(); the
// admin_users_summary RPC re-checks role at the SQL layer (defense in depth).
export default async function AdminUsersPage() {
  const users = await listUsersWithStats();

  const studentCount = users.filter((u) => u.role === 'student').length;
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const active = users.filter((u) => u.tests_taken > 0).length;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Users</h1>
      <p className="text-sm text-slate-500">
        {users.length} total · {studentCount} student{studentCount === 1 ? '' : 's'}
        {' · '}
        {adminCount} admin{adminCount === 1 ? '' : 's'} · {active} active
        {' '}
        (1+ test{active === 1 ? '' : 's'})
      </p>

      <div className="mt-6 space-y-2">
        {users.length === 0 ? (
          <p className="text-sm text-slate-500">No users yet.</p>
        ) : (
          users.map((u) => <UserRow key={u.id} user={u} />)
        )}
      </div>
    </main>
  );
}
