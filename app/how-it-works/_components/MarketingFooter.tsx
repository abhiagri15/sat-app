// app/how-it-works/_components/MarketingFooter.tsx
import Link from 'next/link';
import { ContactLink } from './ContactLink';

export function MarketingFooter() {
  // Contact address is assembled CLIENT-side (ContactLink): this is a Server
  // Component, so any template assembly here would still ship the contiguous
  // address in the static HTML — exactly what spec §E forbids.
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
          <ContactLink className="underline hover:text-slate-700" />
          . For a problem with a specific question, use the Report option in your
          review.
        </p>
      </div>
    </footer>
  );
}
