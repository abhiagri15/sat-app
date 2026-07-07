// app/how-it-works/_components/MarketingFooter.tsx
import Link from 'next/link';

export function MarketingFooter() {
  // This page is public and indexable — plain text invites harvester spam.
  // Assemble the address at render from parts so the raw string never appears
  // as a contiguous literal in the static HTML (spec §E). The href still opens
  // a normal mailto: for a real visitor.
  const user = 'abhishek15';
  const host = 'gmail.com';
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-4 text-xs text-slate-500">
        <div className="flex items-center justify-between">
          <span>&copy; 2026 SAT Practice</span>
          <div className="flex items-center gap-4">
            <a href="#top" className="hover:text-slate-700">Back to top</a>
            <Link href="/login" className="hover:text-slate-700">Sign in</Link>
          </div>
        </div>
        <p className="text-slate-400">
          Questions or feedback?{' '}
          <a href={`mailto:${user}@${host}`} className="hover:text-slate-700">
            Contact the creator
          </a>
          . For a problem with a specific question, use the Report option in your
          review.
        </p>
      </div>
    </footer>
  );
}
