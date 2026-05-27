'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ACTIVITIES,
  DEFAULTS,
  JOINED,
  ROLES,
  SCORE_BANDS,
  SORT_DIRS,
  SORT_KEYS,
  buildUsersHref,
  type Activity,
  type Joined,
  type Role,
  type ScoreBand,
  type SortDir,
  type SortKey,
  type UsersSearchParams,
} from '@/app/lib/admin/users-search';

interface Props {
  current: UsersSearchParams;
}

const ROLE_LABEL:  Record<Role, string>      = { all: 'All', student: 'Students', admin: 'Admins' };
const ACT_LABEL:   Record<Activity, string>  = { all: 'All', active: 'Active', inactive: 'Inactive', never: 'Never started' };
const JOIN_LABEL:  Record<Joined, string>    = { all: 'All', '7': 'Last 7d', '30': 'Last 30d', '90': 'Last 90d' };
const SCORE_LABEL: Record<ScoreBand, string> = {
  all: 'All', 'lt-1000': '<1000', '1000-1200': '1000–1200',
  '1200-1400': '1200–1400', 'gte-1400': '1400+',
};
const SORT_LABEL:  Record<SortKey, string>   = {
  name: 'Name', email: 'Email', role: 'Role', tests: 'Tests taken',
  avg_score: 'Avg score', last_active: 'Last active', joined: 'Joined',
};
const DIR_LABEL:   Record<SortDir, string>   = { asc: 'Ascending', desc: 'Descending' };

export function UsersToolbar({ current }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(current.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync if the URL changes externally (Back/Forward).
  useEffect(() => {
    setQ(current.q);
  }, [current.q]);

  // Any param change resets page to 1 (the previous page number is
  // meaningless against a different filter set).
  const push = (next: Partial<UsersSearchParams>) => {
    const merged: UsersSearchParams = { ...current, ...next, page: 1 };
    startTransition(() => router.replace(buildUsersHref(merged), { scroll: false }));
  };

  const onSearch = (value: string) => {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => push({ q: value }), 250);
  };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const showClear = useMemo(() => {
    return (
      current.q !== DEFAULTS.q ||
      current.role !== DEFAULTS.role ||
      current.activity !== DEFAULTS.activity ||
      current.joined !== DEFAULTS.joined ||
      current.score !== DEFAULTS.score ||
      current.sort !== DEFAULTS.sort ||
      current.dir !== DEFAULTS.dir
    );
  }, [current]);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="search"
          placeholder="Search name or email…"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm
                     placeholder:text-slate-400 focus:border-blue-400 focus:outline-none
                     focus:ring-1 focus:ring-blue-300"
        />
        {showClear && (
          <Link
            href="/admin/users"
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            Clear filters
          </Link>
        )}
      </div>

      <PillRow
        label="Role"
        values={ROLES}
        labels={ROLE_LABEL}
        current={current.role}
        onPick={(v) => push({ role: v })}
      />
      <PillRow
        label="Activity"
        values={ACTIVITIES}
        labels={ACT_LABEL}
        current={current.activity}
        onPick={(v) => push({ activity: v })}
      />
      <PillRow
        label="Joined"
        values={JOINED}
        labels={JOIN_LABEL}
        current={current.joined}
        onPick={(v) => push({ joined: v })}
      />
      <PillRow
        label="Score"
        values={SCORE_BANDS}
        labels={SCORE_LABEL}
        current={current.score}
        onPick={(v) => push({ score: v })}
      />

      <div className="flex flex-wrap items-center gap-3 pt-1 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          Sort by
          <select
            value={current.sort}
            onChange={(e) => push({ sort: e.target.value as SortKey })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>{SORT_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Order
          <select
            value={current.dir}
            onChange={(e) => push({ dir: e.target.value as SortDir })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {SORT_DIRS.map((d) => (
              <option key={d} value={d}>{DIR_LABEL[d]}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function PillRow<T extends string>({
  label,
  values,
  labels,
  current,
  onPick,
}: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  current: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-16 shrink-0 text-slate-500">{label}:</span>
      {values.map((v) => {
        const active = v === current;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            className={
              'rounded-full border px-3 py-1 text-xs transition ' +
              (active
                ? 'border-blue-500 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
            }
          >
            {labels[v]}
          </button>
        );
      })}
    </div>
  );
}
