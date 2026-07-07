'use client';

import { useState, useTransition } from 'react';
import { MISS_REASONS } from '@/app/lib/practice/miss-reasons';
import { tagMissReason } from '@/app/lib/practice/tag-actions';

interface MissReasonChipsProps {
  // Which response table the id lives in ('test' → attempt_responses,
  // 'practice' → practice_responses).
  origin: 'test' | 'practice';
  // The response row id being tagged.
  responseId: string;
  // The already-persisted reason value, or null when untagged.
  initial: string | null;
}

// "Why did you miss this?" chip row (#18, design spec §A). Six one-tap chips
// derived from MISS_REASONS; the selected chip is highlighted (amber family).
// Tap a chip to set that reason; tap the selected chip again to clear it (reason
// null — re-taggable). The write is optimistic: the UI updates immediately and
// REVERTS to the last-confirmed value if the server action returns
// {ok:false} or {applied:false} (a stale/foreign/correct-row no-op, or the RPC
// failing live because the migration isn't applied yet). Compact; wraps.
export function MissReasonChips({ origin, responseId, initial }: MissReasonChipsProps) {
  // The last value the server confirmed (or the initial prop) — the revert
  // target when an optimistic write is rejected.
  const [confirmed, setConfirmed] = useState<string | null>(initial);
  // The value shown right now (optimistic; may briefly lead `confirmed`).
  const [selected, setSelected] = useState<string | null>(initial);
  const [, startTransition] = useTransition();

  function onChip(value: string) {
    // Tapping the selected chip clears it; otherwise set the tapped reason.
    const next = selected === value ? null : value;
    const revertTo = confirmed;
    setSelected(next); // optimistic
    startTransition(async () => {
      const res = await tagMissReason(origin, responseId, next);
      if (res.ok && res.applied) {
        setConfirmed(next);
      } else {
        // Rejected (bad input, no matching row, or RPC error) — revert.
        setSelected(revertTo);
      }
    });
  }

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Why did you miss this?
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {MISS_REASONS.map((r) => {
          const isSelected = selected === r.value;
          return (
            <button
              key={r.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChip(r.value)}
              className={
                isSelected
                  ? 'rounded-full border border-amber-400 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-200'
                  : 'rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-amber-300 hover:bg-amber-50'
              }
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
