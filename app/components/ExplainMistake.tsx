'use client';

import { useState } from 'react';

// The client fallback snapshot for a review item whose sat.questions row may be
// gone. Carries just enough for the server to build the coach prompt when the
// live re-read misses. Mirrors the route's Snapshot shape.
export interface ExplainSnapshot {
  prompt: string;
  passage?: string | null;
  choices?: string[];
  answerIndex?: number | null;
  correctAnswer?: string | null;
  responseFormat?: 'mcq' | 'spr';
  skill?: string;
  section?: 'rw' | 'math';
}

interface ExplainMistakeProps {
  questionId: string;
  // mcq → the chosen choice index; spr → null.
  chosen: number | null;
  // spr → the typed entry; mcq → null.
  entered: string | null;
  responseFormat: 'mcq' | 'spr';
  // Present for review items (question row may be gone); omitted for live drill
  // rows (the server always re-reads them successfully).
  snapshot?: ExplainSnapshot;
}

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; explanation: string; takeaway: string }
  | { phase: 'error'; message: string };

// "Explain my mistake" (design spec §E). A button that fetches a one-shot coach
// explanation of the student's specific wrong answer and renders it inline,
// React-escaped. Single-fire per mount: the button disappears once a request is
// in flight or done; only the error state offers a retry. Rendered only on
// incorrectly-answered items by the caller (DrillQuestion / ReviewItem).
export function ExplainMistake({
  questionId,
  chosen,
  entered,
  responseFormat,
  snapshot,
}: ExplainMistakeProps) {
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function run() {
    setState({ phase: 'loading' });
    try {
      const res = await fetch('/api/practice/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, chosen, entered, snapshot }),
      });
      if (res.status === 429) {
        setState({
          phase: 'error',
          message: "You've reached today's explanation limit — try again tomorrow.",
        });
        return;
      }
      if (!res.ok) {
        setState({ phase: 'error', message: "Couldn't reach the coach — try again." });
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        explanation?: unknown;
        takeaway?: unknown;
      };
      if (
        !data.ok ||
        typeof data.explanation !== 'string' ||
        typeof data.takeaway !== 'string'
      ) {
        setState({ phase: 'error', message: "Couldn't reach the coach — try again." });
        return;
      }
      setState({
        phase: 'done',
        explanation: data.explanation,
        takeaway: data.takeaway,
      });
    } catch {
      setState({ phase: 'error', message: "Couldn't reach the coach — try again." });
    }
  }

  if (state.phase === 'idle') {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={run}
          className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-100"
        >
          Explain my mistake
        </button>
      </div>
    );
  }

  if (state.phase === 'loading') {
    return (
      <div className="mt-3 animate-pulse rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
        <div className="h-3 w-24 rounded bg-indigo-200" />
        <div className="mt-3 h-2.5 w-full rounded bg-indigo-100" />
        <div className="mt-2 h-2.5 w-11/12 rounded bg-indigo-100" />
        <div className="mt-2 h-2.5 w-4/5 rounded bg-indigo-100" />
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {state.message}{' '}
        <button
          type="button"
          onClick={run}
          className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
        >
          Retry
        </button>
      </div>
    );
  }

  // done — render the coach card, React-escaped.
  return (
    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">
        Coach
      </p>
      <p className="mt-2 text-sm text-slate-700">{state.explanation}</p>
      <p className="mt-3 text-sm text-slate-800">
        <span className="font-semibold text-indigo-700">Takeaway:</span>{' '}
        {state.takeaway}
      </p>
    </div>
  );
}
