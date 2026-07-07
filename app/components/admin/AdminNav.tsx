'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Sub-nav shown on every /admin page (rendered by the admin layout).
// Highlights the active section. Lives as a client component because the
// active-tab logic needs the current pathname.

interface Tab {
  label: string;
  href: string;
  // /admin matches only the exact path; the others match path === href OR
  // path starting with href + '/' so detail routes still light up the tab
  // (e.g. /admin/questions/<id> highlights "Question Pool").
  exact?: boolean;
}

const TABS: Tab[] = [
  { label: 'Overview', href: '/admin', exact: true },
  { label: 'Question Pool', href: '/admin/questions' },
  { label: 'Pool Health', href: '/admin/pool' },
  { label: 'Users', href: '/admin/users' },
  { label: 'Open Flags', href: '/admin/flags' },
  { label: 'Review queue', href: '/admin/review' },
  { label: 'Settings', href: '/admin/settings' },
];

function isActive(pathname: string, tab: Tab): boolean {
  if (tab.exact) return pathname === tab.href;
  return pathname === tab.href || pathname.startsWith(tab.href + '/');
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl flex-wrap gap-1 px-6 py-2">
        {TABS.map((t) => {
          const active = isActive(pathname, t);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
