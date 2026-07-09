// app/privacy/page.tsx
//
// Public, static privacy policy. Server component, plain prose — matching the
// /how-it-works marketing tone (no legalese overreach; honest scope for a free,
// family-run practice app). Public route: listed in middleware.ts PUBLIC_PATHS
// so it is reachable signed-out.
import Link from 'next/link';
import { MarketingHeader } from '@/app/how-it-works/_components/MarketingHeader';
import { MarketingFooter } from '@/app/how-it-works/_components/MarketingFooter';
import { ContactLink } from '@/app/how-it-works/_components/ContactLink';

export const metadata = {
  title: 'Privacy — SAT Practice',
  description:
    'What this SAT practice app collects, why, where it lives, and how to see or delete your data.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-bold text-slate-900">Privacy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated July 2026</p>

        <div className="mt-8 space-y-8 text-slate-700">
          <p>
            This is a small, free SAT practice app run by a family, not a
            company with a marketing department. This page explains, in plain
            language, what we keep and what we do with it. If anything here is
            unclear, please just ask.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              What we collect
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Your name and email address, so you can sign in.</li>
              <li>
                Your test and practice performance history — the questions you
                saw, the answers you gave, and how you scored.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Why we keep it</h2>
            <p className="mt-3">
              We keep your performance history so we can show you your progress
              over time and so practice can adapt to your weak spots — drills
              bring back the skills you keep missing, and coaching notes reflect
              your recent work. That is the whole point of the app; the data is
              what makes it useful to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Where it lives</h2>
            <p className="mt-3">
              Your data is stored in a Supabase-hosted database. Access is
              restricted to your own account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              What we don&apos;t do
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>We don&apos;t sell your data. Ever.</li>
              <li>We don&apos;t run ads.</li>
              <li>We don&apos;t use third-party advertising or tracking cookies.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              A note about AI
            </h2>
            <p className="mt-3">
              The practice questions, lessons, and explanations in this app are
              AI-generated. When you answer questions, your answers are
              processed to build the coaching guidance and drills that adapt to
              how you&apos;re doing. This is how the practice stays targeted to
              you; it is not used for anything else.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">
              Seeing and deleting your data
            </h2>
            <p className="mt-3">
              You&apos;re in control of your data. From your{' '}
              <Link href="/dashboard" className="text-blue-600 hover:underline">
                dashboard
              </Link>{' '}
              you can:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <span className="font-medium">Download your data</span> — a JSON
                file with your profile, test attempts, practice sessions, and
                study plan.
              </li>
              <li>
                <span className="font-medium">Delete your account</span> — this
                permanently removes your account and all of your test and
                practice history. It cannot be undone.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Questions</h2>
            <p className="mt-3">
              For any question about your privacy, or if you&apos;re a parent
              making a request on behalf of your child, please{' '}
              <ContactLink className="text-blue-600 hover:underline" />. The
              address is vatekinc [at] gmail [dot] com.
            </p>
          </section>

          <p className="border-t border-slate-200 pt-6 text-sm text-slate-500">
            See also our{' '}
            <Link href="/terms" className="text-blue-600 hover:underline">
              Terms of Use
            </Link>
            .
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
