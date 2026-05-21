'use client';

import { clsx } from 'clsx';
import { fmtTime } from '@/app/lib/test';

interface TopBarProps {
  secIdx: number;
  qIdx: number;
  totalQ: number;
  studentName: string;
  remaining: number;          // seconds left in the current section
}

export function TopBar({ secIdx, qIdx, totalQ, studentName, remaining }: TopBarProps) {
  const timerClass = clsx(
    'tabular-nums font-bold text-lg rounded-md px-3 py-1',
    remaining <= 30 ? 'bg-red-100 text-red-700'
      : remaining <= 120 ? 'bg-amber-100 text-amber-700'
      : 'bg-indigo-50 text-indigo-900',
  );
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-white px-4 sm:px-5 py-2.5 shadow-sm">
      <div className="text-xs text-slate-500">
        Section <b className="text-slate-900">{secIdx + 1}</b> · Question <b className="text-slate-900">{qIdx + 1}</b>/<b className="text-slate-900">{totalQ}</b>
      </div>
      <div className={timerClass}>{fmtTime(Math.max(0, remaining))}</div>
      <div className="text-xs text-slate-500">{studentName}</div>
    </div>
  );
}
