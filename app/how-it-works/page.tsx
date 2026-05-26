// app/how-it-works/page.tsx
//
// Public-facing explainer for the SAT practice app. Server component with
// ISR (revalidate = 3600) — the page is regenerated at most once an hour,
// so live pool numbers may lag by up to 60 minutes (acceptable for a
// marketing page; no one reloads twice in an hour).

export const revalidate = 3600;

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-3xl font-bold">How it works</h1>
      <p className="mt-4 text-slate-600">Coming soon.</p>
    </main>
  );
}
