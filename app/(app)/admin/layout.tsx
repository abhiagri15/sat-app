import type { ReactNode } from 'react';
import { requireAdmin } from '@/app/lib/admin/guard';

// Gates the whole /admin subtree to admins; requireAdmin() 404s everyone else.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
