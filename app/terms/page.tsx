// app/terms/page.tsx
//
// Public, static terms of use. Server component, plain prose — matching the
// /how-it-works marketing tone (honest scope, no legalese overreach). Public
// route: listed in middleware.ts PUBLIC_PATHS so it is reachable signed-out.
import Link from 'next/link';
import { MarketingHeader } from '@/app/how-it-works/_components/MarketingHeader';
import { MarketingFooter } from '@/app/how-it-works/_components/MarketingFooter';
import { ContactLink } from '@/app/how-it-works/_components/ContactLink';

export const metadata = {
  title: 'Terms — SAT Practice',
  description:
    'The plain-language terms for using this free SAT practice app.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-bold text-slate-900">Terms of Use</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated July 2026</p>

        <div className="mt-8 space-y-8 text-slate-700">
          <p>
            This is a free SAT practice app run by a family. By using it, you
            agree to these simple terms. We&apos;ve kept them plain on purpose.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              Free, and provided as-is
            </h2>
            <p className="mt-3">
              The app is free to use and provided as-is, without warranties. We
              build it in good faith and try to keep it working and accurate,
              but we can&apos;t guarantee it will always be available or
              error-free.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              Scores are practice estimates
            </h2>
            <p className="mt-3">
              We don&apos;t guarantee any score outcome. The scores this app
              shows are practice estimates to help you gauge your progress —
              they are <span className="font-medium">not</span> official College
              Board scores, and they won&apos;t match an official SAT report
              exactly.
            </p>
            <p className="mt-3">
              This app is not affiliated with, endorsed by, or connected to the
              College Board. &ldquo;SAT&rdquo; is a trademark of the College
              Board; we use it only to describe what the app helps you practice
              for.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              Acceptable use
            </h2>
            <p className="mt-3">
              Please use the app for your own SAT practice. Don&apos;t scrape the
              question pool, don&apos;t try to overload or abuse the service, and
              don&apos;t use it in a way that would spoil it for other students.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              Accounts for minors
            </h2>
            <p className="mt-3">
              Many students preparing for the SAT are under 18. If you&apos;re a
              minor, your account should be created and supervised by a parent
              or guardian. Parents are welcome to contact us with any request
              about their child&apos;s account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              Your data and your account
            </h2>
            <p className="mt-3">
              How we handle your data is described in our{' '}
              <Link href="/privacy" className="text-blue-600 hover:underline">
                Privacy policy
              </Link>
              . You can download your data or delete your account at any time
              from your{' '}
              <Link href="/dashboard" className="text-blue-600 hover:underline">
                dashboard
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Questions</h2>
            <p className="mt-3">
              Questions about these terms? Please{' '}
              <ContactLink className="text-blue-600 hover:underline" />. The
              address is vatekinc [at] gmail [dot] com.
            </p>
          </section>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
