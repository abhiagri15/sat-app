# SAT-App Feedback — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a user flag a bad question from any question review; surface flags in the admin area for an admin to resolve.

**Architecture:** A `sat.question_flags` table (RLS enabled, no policies). Users file flags through a `security definer` RPC `submit_flag`; a `FlagQuestion` client widget in `ReviewItem` calls a `submitFlag` server action. Admins read and resolve flags through the service-role client behind `requireAdmin()`, on a new `/admin/flags` page; `/admin` links to it with an open-flag count.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · pnpm · `@supabase/ssr` + `@supabase/supabase-js` · zod · Postgres.

**Spec:** [2026-05-21-sat-app-feedback-design.md](../specs/2026-05-21-sat-app-feedback-design.md)

**Builds on:** `post-admin`. Lands eight commits on `main`, tagged `post-feedback`. Final sub-project.

**Verification:** `pnpm type-check` / `lint` / `build` + MCP SQL. No unit-test runner.

**Shell:** Windows / PowerShell. Use the **Bash tool with a `cat <<'EOF'` here-doc** for every commit. Run from `C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/satpracticereact/sat-app`.

**Migration application:** the implementer writes & commits the `.sql`; the **controller** applies it via `mcp__claude_ai_Supabase__apply_migration` and verifies.

**No new env vars.**

---

## Plan-wide File Structure

```
supabase/migrations/20260521080000_sat_question_flags.sql   # CREATED (Task 1)
app/lib/feedback/actions.ts      # CREATED (Task 2)
app/components/FlagQuestion.tsx  # CREATED (Task 3)
app/components/ReviewItem.tsx    # MODIFIED (Task 3)
app/lib/admin/flags.ts           # CREATED (Task 4)
app/lib/admin/actions.ts         # MODIFIED (Task 5: + resolveFlag)
app/components/admin/FlagRow.tsx          # CREATED (Task 6)
app/(app)/admin/flags/page.tsx            # CREATED (Task 6)
app/(app)/admin/page.tsx                  # MODIFIED (Task 7: + open-flag link)
README.md / CLAUDE.md                     # MODIFIED (Task 8)
```

---

## Chunk 1: Data + user-facing flagging

### Task 1: `question_flags` table + `submit_flag` RPC

**Files:** Create `supabase/migrations/20260521080000_sat_question_flags.sql`

- [ ] **Step 1.1:** Create the file with EXACTLY:

```sql
-- Feedback sub-project — user-reported problems with pool questions.

create table if not exists sat.question_flags (
  id           uuid primary key default gen_random_uuid(),
  question_id  text not null references sat.questions (id) on delete cascade,
  user_id      uuid not null references auth.users (id)   on delete cascade,
  reason       text not null check (reason in ('wrong_answer','unclear','typo','other')),
  comment      text check (char_length(comment) <= 500),
  status       text not null default 'open' check (status in ('open','resolved')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users (id)
);
create index if not exists question_flags_status_idx
  on sat.question_flags (status, created_at desc);
create index if not exists question_flags_question_idx
  on sat.question_flags (question_id);

alter table sat.question_flags enable row level security;
-- No policies: authenticated users file flags only through submit_flag
-- (security definer); admins read/resolve through the service-role client.

create or replace function sat.submit_flag(
  p_question_id text, p_reason text, p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  insert into sat.question_flags (question_id, user_id, reason, comment)
  values (p_question_id, v_user, p_reason, nullif(trim(p_comment), ''))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function sat.submit_flag(text, text, text) to authenticated;
```

- [ ] **Step 1.2:** Commit.

```bash
git add supabase/migrations/20260521080000_sat_question_flags.sql && git commit -F- <<'EOF'
feat(feedback): sat.question_flags table + submit_flag RPC

A table for user-reported problems with pool questions (RLS enabled, no
policies) and a security-definer submit_flag RPC that files a flag with
user_id taken from auth.uid().

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 1.3 (controller):** Apply via `mcp__claude_ai_Supabase__apply_migration` (name `sat_question_flags`).
- [ ] **Step 1.4 (controller):** Verify with `execute_sql`:

```sql
select c.relname, c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname='sat' and p.tablename='question_flags') as policy_count
from pg_class c where c.relnamespace = 'sat'::regnamespace and c.relname = 'question_flags';
select proname, prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'sat' and p.proname = 'submit_flag';
```

Expected: `question_flags` exists, `rls_enabled = true`, `policy_count = 0`; `submit_flag` exists with `security_definer = true`.

### Task 2: `submitFlag` server action

**Files:** Create `app/lib/feedback/actions.ts`

- [ ] **Step 2.1:** Create `app/lib/feedback/actions.ts` with EXACTLY:

```ts
'use server';

import { z } from 'zod';
import { createClient } from '@/app/lib/supabase/server';

const flagSchema = z.object({
  questionId: z.string().min(1),
  reason: z.enum(['wrong_answer', 'unclear', 'typo', 'other']),
  comment: z.string().max(500),
});

export type SubmitFlagResult = { ok: true } | { ok: false; error: string };

// Files a user-reported problem with a pool question. Validates, then calls the
// submit_flag RPC (security definer — it sets user_id from auth.uid()).
export async function submitFlag(input: {
  questionId: string;
  reason: string;
  comment: string;
}): Promise<SubmitFlagResult> {
  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Please choose a reason.' };
  }
  const { questionId, reason, comment } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.schema('sat').rpc('submit_flag', {
    p_question_id: questionId,
    p_reason: reason,
    p_comment: comment,
  });
  if (error) {
    console.error('[submitFlag] failed:', error);
    return { ok: false, error: 'Could not submit the report. Please try again.' };
  }
  return { ok: true };
}
```

- [ ] **Step 2.2:** Run `pnpm type-check` (exits 0) and `pnpm lint` (no errors).
- [ ] **Step 2.3:** Commit.

```bash
git add app/lib/feedback/actions.ts && git commit -F- <<'EOF'
feat(feedback): submitFlag server action

Zod-validates a flag and files it via the submit_flag RPC.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 3: `FlagQuestion` widget + `ReviewItem` integration

**Files:** Create `app/components/FlagQuestion.tsx`; modify `app/components/ReviewItem.tsx`

- [ ] **Step 3.1:** Create `app/components/FlagQuestion.tsx` with EXACTLY:

```tsx
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
```

- [ ] **Step 3.2:** Modify `app/components/ReviewItem.tsx`. Read it first. Find this exact import line:

```tsx
import type { Question } from '@/app/lib/questions';
```

and replace it with:

```tsx
import type { Question } from '@/app/lib/questions';
import { FlagQuestion } from './FlagQuestion';
```

- [ ] **Step 3.3:** In the same file, find this exact block (the explanation `<div>` followed by the component's closing `</div>`):

```tsx
      <div className="mt-3 text-sm text-slate-700">
        <b className="text-blue-700">Why:</b>{' '}
        {question.source === 'seed' ? (
          <span dangerouslySetInnerHTML={{ __html: question.explanation }} />
        ) : (
          <span>{question.explanation}</span>
        )}
      </div>
    </div>
```

and replace it with (the `FlagQuestion` widget added before the closing `</div>`):

```tsx
      <div className="mt-3 text-sm text-slate-700">
        <b className="text-blue-700">Why:</b>{' '}
        {question.source === 'seed' ? (
          <span dangerouslySetInnerHTML={{ __html: question.explanation }} />
        ) : (
          <span>{question.explanation}</span>
        )}
      </div>
      <FlagQuestion questionId={question.id} />
    </div>
```

If either anchor does not appear verbatim, STOP and report BLOCKED.

- [ ] **Step 3.4:** Run `pnpm type-check` (exits 0), `pnpm lint` (no errors), `pnpm build` (completes).
- [ ] **Step 3.5:** Commit.

```bash
git add app/components/FlagQuestion.tsx app/components/ReviewItem.tsx && git commit -F- <<'EOF'
feat(feedback): FlagQuestion widget in question reviews

A "Report a problem" widget (reason + optional comment) rendered under
every reviewed question via ReviewItem — so a flag can be filed from the
post-test results review and the saved-attempt review alike.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

---

## Chunk 2: Admin flag review

### Task 4: admin flag queries

**Files:** Create `app/lib/admin/flags.ts`

- [ ] **Step 4.1:** Create `app/lib/admin/flags.ts` with EXACTLY:

```ts
import { createAdminClient } from '@/app/lib/supabase/admin';

export type FlagStatus = 'open' | 'resolved';

export interface QuestionFlag {
  id: string;
  question_id: string;
  reason: string;
  comment: string | null;
  status: FlagStatus;
  created_at: string;
  question_prompt: string;
  question_section: string;
  question_enabled: boolean;
}

interface FlagRowRaw {
  id: string;
  question_id: string;
  reason: string;
  comment: string | null;
  status: FlagStatus;
  created_at: string;
}

interface QuestionLite {
  id: string;
  prompt: string;
  section: string;
  enabled: boolean;
}

// Admin-only. question_flags has no RLS policy, so reads go through the
// service-role client. Flags first, then the referenced questions, merged in JS.
export async function listFlags(
  status: FlagStatus | 'all',
): Promise<QuestionFlag[]> {
  const admin = createAdminClient();
  let query = admin
    .schema('sat')
    .from('question_flags')
    .select('id, question_id, reason, comment, status, created_at');
  if (status !== 'all') query = query.eq('status', status);
  const { data: flags, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !flags) {
    console.error('[listFlags] failed:', error);
    return [];
  }
  const rows = flags as unknown as FlagRowRaw[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.question_id))];
  const { data: questions } = await admin
    .schema('sat')
    .from('questions')
    .select('id, prompt, section, enabled')
    .in('id', ids);
  const qmap = new Map(
    ((questions ?? []) as unknown as QuestionLite[]).map((q) => [q.id, q]),
  );

  return rows.map((r) => {
    const q = qmap.get(r.question_id);
    return {
      ...r,
      question_prompt: q?.prompt ?? '(question not found)',
      question_section: q?.section ?? '',
      question_enabled: q?.enabled ?? true,
    };
  });
}

// Count of open flags, for the /admin entry-point link.
export async function countOpenFlags(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .schema('sat')
    .from('question_flags')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');
  if (error) {
    console.error('[countOpenFlags] failed:', error);
    return 0;
  }
  return count ?? 0;
}
```

- [ ] **Step 4.2:** Run `pnpm type-check` (exits 0).
- [ ] **Step 4.3:** Commit.

```bash
git add app/lib/admin/flags.ts && git commit -F- <<'EOF'
feat(feedback): admin flag queries

listFlags (filtered, with the question merged in) and countOpenFlags —
read sat.question_flags via the service-role client for the admin review.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 5: `resolveFlag` admin action

**Files:** Modify `app/lib/admin/actions.ts`

- [ ] **Step 5.1:** Append the following to the END of `app/lib/admin/actions.ts` (after the existing `setQuestionEnabled` function — the imports it needs, `revalidatePath`, `requireAdmin`, `createAdminClient`, are all already imported in that file):

```ts

// Resolve a question flag. Admin-only; writes via the service-role client
// (question_flags has no RLS policy).
export async function resolveFlag(flagId: string): Promise<void> {
  const profile = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('question_flags')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: profile.id,
    })
    .eq('id', flagId);
  if (error) {
    console.error('[resolveFlag] failed:', error);
    throw new Error('Failed to resolve the flag.');
  }
  revalidatePath('/admin/flags');
  revalidatePath('/admin');
}
```

- [ ] **Step 5.2:** Run `pnpm type-check` (exits 0) and `pnpm lint` (no errors).
- [ ] **Step 5.3:** Commit.

```bash
git add app/lib/admin/actions.ts && git commit -F- <<'EOF'
feat(feedback): resolveFlag admin action

Admin-gated action that marks a flag resolved (status, resolved_at,
resolved_by) via the service-role client.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 6: `FlagRow` + `/admin/flags` page

**Files:** Create `app/components/admin/FlagRow.tsx`, `app/(app)/admin/flags/page.tsx`

- [ ] **Step 6.1:** Create `app/components/admin/FlagRow.tsx` with EXACTLY:

```tsx
import Link from 'next/link';
import { resolveFlag } from '@/app/lib/admin/actions';
import type { QuestionFlag } from '@/app/lib/admin/flags';

const REASON_LABELS: Record<string, string> = {
  wrong_answer: 'Wrong answer',
  unclear: 'Unclear',
  typo: 'Typo / formatting',
  other: 'Other',
};

function truncate(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// One flag row: reason, the flagged question (truncated, linked), the optional
// comment, and — for an open flag — a Mark-resolved form.
export function FlagRow({ flag }: { flag: QuestionFlag }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
          {REASON_LABELS[flag.reason] ?? flag.reason}
        </span>
        {flag.status === 'resolved' && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
            Resolved
          </span>
        )}
        {!flag.question_enabled && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">
            Question disabled
          </span>
        )}
        <span className="text-slate-400">
          {new Date(flag.created_at).toLocaleDateString()}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-800">
        {truncate(flag.question_prompt)}
      </p>
      {flag.comment && (
        <p className="mt-1 text-xs italic text-slate-500">“{flag.comment}”</p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <Link
          href={`/admin/questions/${flag.question_id}`}
          className="text-xs text-blue-600 underline"
        >
          View question
        </Link>
        {flag.status === 'open' && (
          <form action={resolveFlag.bind(null, flag.id)}>
            <button
              type="submit"
              className="rounded bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              Mark resolved
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6.2:** Create `app/(app)/admin/flags/page.tsx` with EXACTLY:

```tsx
import Link from 'next/link';
import { listFlags, type FlagStatus } from '@/app/lib/admin/flags';
import { FlagRow } from '@/app/components/admin/FlagRow';

const STATUS_FILTERS: { label: string; status: FlagStatus | 'all' }[] = [
  { label: 'Open', status: 'open' },
  { label: 'Resolved', status: 'resolved' },
  { label: 'All', status: 'all' },
];

export default async function AdminFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status: FlagStatus | 'all' =
    sp.status === 'resolved' || sp.status === 'all' ? sp.status : 'open';
  const flags = await listFlags(status);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-blue-600 underline">
        ← Back to the pool
      </Link>
      <h1 className="mb-1 mt-3 text-2xl font-bold">Question flags</h1>
      <p className="text-sm text-slate-500">
        User-reported problems with pool questions.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.status}
            href={f.status === 'open' ? '/admin/flags' : `/admin/flags?status=${f.status}`}
            className={`rounded-full px-3 py-1 text-xs ${
              status === f.status
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="mt-6 space-y-2">
        {flags.length === 0 ? (
          <p className="text-sm text-slate-500">No flags here.</p>
        ) : (
          flags.map((f) => <FlagRow key={f.id} flag={f} />)
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 6.3:** Run `pnpm type-check` (exits 0); `pnpm build` (completes, `/admin/flags` builds).
- [ ] **Step 6.4:** Commit.

```bash
git add app/components/admin/FlagRow.tsx "app/(app)/admin/flags/page.tsx" && git commit -F- <<'EOF'
feat(feedback): /admin/flags review page + FlagRow

The /admin/flags page (under the admin role gate) lists flags with a
status filter; each FlagRow links to the flagged question and offers a
Mark-resolved action for open flags.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 7: open-flag link on `/admin`

**Files:** Modify `app/(app)/admin/page.tsx`

- [ ] **Step 7.1:** In `app/(app)/admin/page.tsx`, find this exact import line:

```tsx
import { QuestionRow } from '@/app/components/admin/QuestionRow';
```

and replace it with:

```tsx
import { QuestionRow } from '@/app/components/admin/QuestionRow';
import { countOpenFlags } from '@/app/lib/admin/flags';
```

- [ ] **Step 7.2:** In the same file, find this exact block:

```tsx
  const [counts, questions] = await Promise.all([
    getPoolCounts(),
    listQuestions(filters),
  ]);
```

and replace it with:

```tsx
  const [counts, questions, openFlags] = await Promise.all([
    getPoolCounts(),
    listQuestions(filters),
    countOpenFlags(),
  ]);
```

- [ ] **Step 7.3:** In the same file, find this exact block (the pool-counts paragraph):

```tsx
      <p className="text-sm text-slate-500">
        {counts.total} questions · {counts.enabled} enabled · {counts.disabled}{' '}
        disabled · {counts.ai} AI · {counts.seed} seed · {counts.rw} R&amp;W ·{' '}
        {counts.math} Math
      </p>
```

and replace it with (the same paragraph, plus a flags link after it):

```tsx
      <p className="text-sm text-slate-500">
        {counts.total} questions · {counts.enabled} enabled · {counts.disabled}{' '}
        disabled · {counts.ai} AI · {counts.seed} seed · {counts.rw} R&amp;W ·{' '}
        {counts.math} Math
      </p>
      <Link
        href="/admin/flags"
        className="mt-2 inline-block text-sm text-blue-600 underline"
      >
        {openFlags} open flag{openFlags === 1 ? '' : 's'} →
      </Link>
```

If any anchor does not appear verbatim, STOP and report BLOCKED.

- [ ] **Step 7.4:** Run `pnpm type-check` (exits 0), `pnpm lint` (no errors), `pnpm build` (completes).
- [ ] **Step 7.5:** Commit.

```bash
git add "app/(app)/admin/page.tsx" && git commit -F- <<'EOF'
feat(feedback): open-flag count link on /admin

The admin pool page now shows the number of open flags and links to
/admin/flags.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 8: verification + docs

**Files:** Modify `README.md`, `CLAUDE.md`

- [ ] **Step 8.1:** Run `pnpm type-check`, `pnpm lint`, `pnpm build` — all must pass.
- [ ] **Step 8.2:** Update `README.md` — add a concise "Feedback" section (consistent with the existing sections' style): from any question review a user can report a problem (a reason + optional comment); reported flags appear on `/admin/flags` where an admin reviews and resolves them.
- [ ] **Step 8.3:** Update `CLAUDE.md` — record the feedback sub-project shipped (matching prior sub-projects' style), and add gotchas: `sat.question_flags` has RLS enabled with **no policies** — users file flags only through the `submit_flag` security-definer RPC, admins read/resolve only through the service-role client behind `requireAdmin()`; the `FlagQuestion` widget lives in `ReviewItem`, so it appears in both the post-test results review and the saved-attempt review. Keep edits proportionate.
- [ ] **Step 8.4:** Commit.

```bash
git add README.md CLAUDE.md && git commit -F- <<'EOF'
docs(feedback): sync README and CLAUDE.md for the feedback sub-project

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 8.5 (controller):** After the final whole-implementation review passes, tag: `git tag post-feedback`.

---

## Plan Complete

Eight commits land on `main`: (1) `question_flags` + `submit_flag`, (2) `submitFlag` action, (3) `FlagQuestion` + `ReviewItem`, (4) admin flag queries, (5) `resolveFlag`, (6) `/admin/flags` page + `FlagRow`, (7) `/admin` flag link, (8) docs. Then the `post-feedback` tag — the seventh and final sub-project of the SAT-prep build.
