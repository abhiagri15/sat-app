// app/how-it-works/_components/MarketingHeader.tsx
import Link from 'next/link';

// Page-top bar shown on the marketing /how-it-works page only. Distinct
// from AppHeader (which is built around authenticated user state).
export function MarketingHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-semibold text-slate-900">
          SAT Practice
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Try it free
          </Link>
        </div>
      </div>
    </header>
  );
}
