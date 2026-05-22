'use client';

import { useState } from 'react';
import { submitFlag } from '@/app/lib/feedback/actions';

const REASONS = [
  { value: 'wrong_answer', label: 'The answer is wrong' },
  { value: 'unclear', label: 'The question is unclear' },
  { value: 'typo', label: 'Typo or formatting error' },
  { value: 'other', label: 'Something else' },
];

type Status = 'idle' | 'submitting' | 'done' | 'error';

// A small "Report a problem" widget shown under a reviewed question.
export function FlagQuestion({ questionId }: { questionId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('wrong_answer');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  if (status === 'done') {
    return (
      <p className="mt-2 text-xs text-emerald-700">
        Thanks — this question was reported.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-slate-400 underline hover:text-slate-600"
      >
        Report a problem
      </button>
    );
  }

  async function submit() {
    setStatus('submitting');
    const res = await submitFlag({ questionId, reason, comment });
    setStatus(res.ok ? 'done' : 'error');
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 p-3">
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded border border-slate-300 p-1.5 text-sm"
      >
        {REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional details…"
        maxLength={500}
        rows={2}
        className="mt-2 w-full rounded border border-slate-300 p-1.5 text-sm"
      />
      {status === 'error' && (
        <p className="mt-1 text-xs text-red-600">
          Couldn’t submit — please try again.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={status === 'submitting'}
          className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {status === 'submitting' ? 'Submitting…' : 'Submit report'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2.5 py-1 text-xs text-slate-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
