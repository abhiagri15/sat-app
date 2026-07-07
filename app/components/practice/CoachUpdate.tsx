import type { Guidance } from '@/app/lib/ai/guidance-schema';

interface CoachUpdateProps {
  guidance: Guidance;
  generatedAt: string;
}

// "Jul 5, 2026" style date for the footer.
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// The per-student "Coach's update" card (see the Dynamic Practice spec §B).
// Plain (server-renderable, no hooks). Every field is AI-generated plain text
// and renders React-escaped — no dangerouslySetInnerHTML anywhere. Blue-tinted
// to read as an encouraging callout, mirroring the amber focus-areas callout on
// /analytics.
export function CoachUpdate({ guidance, generatedAt }: CoachUpdateProps) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 sm:p-5">
      <h2 className="text-base font-semibold text-blue-900">
        Your coach&apos;s update
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-blue-900">
        {guidance.summary}
      </p>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Where to focus
        </p>
        <ul className="mt-2 space-y-2">
          {guidance.focus.map((f, i) => (
            <li key={i} className="text-sm text-blue-900">
              <span className="font-semibold">{f.point}</span>
              <span className="font-normal"> — {f.why}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Next steps
        </p>
        <ul className="mt-2 space-y-1.5">
          {guidance.nextSteps.map((step, i) => (
            <li key={i} className="flex gap-2 text-sm text-blue-900">
              <span aria-hidden="true" className="font-bold text-blue-500">
                →
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 text-xs text-blue-700">
        Based on your work through {longDate(generatedAt)}
      </p>
    </div>
  );
}
