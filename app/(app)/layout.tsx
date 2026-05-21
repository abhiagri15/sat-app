import type { ReactNode } from 'react';
import { AppHeader } from '@/app/components/AppHeader';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
