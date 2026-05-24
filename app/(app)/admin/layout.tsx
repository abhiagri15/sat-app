import type { ReactNode } from 'react';
import { requireAdmin } from '@/app/lib/admin/guard';
import { AdminNav } from '@/app/components/admin/AdminNav';

// Gates the whole /admin subtree to admins; requireAdmin() 404s everyone else.
// Also renders the sub-nav on every admin page so the user can switch sections
// without leaving /admin.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
