// app/how-it-works/_components/CtaFooter.tsx
import Link from 'next/link';

export function CtaFooter() {
  return (
    <section className="bg-blue-600">
      <div className="mx-auto max-w-5xl px-6 py-12 text-center">
        <h2 className="text-2xl font-bold text-white">Ready to practice?</h2>
        <p className="mt-2 text-sm text-blue-100">
          Free to start. No credit card required.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            Start free
          </Link>
          <Link href="/login" className="text-sm text-blue-100 hover:text-white">
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
