# SAT Prep — Feedback Sub-Project Design

**Date:** 2026-05-21
**Status:** Approved for plan-writing (autonomous build — design decisions made by the implementer per the stakeholder's standing instruction to proceed without per-step approval)
**Sub-project:** #7 of 7 — Feedback
**Builds on:** Foundation (#1), Auth (#3), AI (#2), Persistence (#4), Analytics (#5), Admin (#6, `post-admin`)

---

## 1. Context

The AI sub-project (#2) generates questions behind an automated gate that
cannot catch a *well-formed but wrong/poor* question. The Admin sub-project (#6)
gave admins a way to disable bad questions — but an admin has to *find* them
first.

This sub-project closes the loop: a user reviewing a test can **flag** a
question they think is wrong, and those flags surface in the admin area so an
admin can review them and disable the offending question. It is the last of the
seven sub-projects.

## 2. Scope

### In scope
- **`sat.question_flags`** table — a user-reported problem with a pool question.
- **`sat.submit_flag(...)`** — a `security definer` RPC so an authenticated user
  can file a flag (sets `user_id := auth.uid()` itself).
- **`submitFlag`** server action + a **`FlagQuestion`** client widget added to
  `ReviewItem`, so a flag can be filed from any question review (post-test
  results *and* the saved-attempt review).
- **`/admin/flags`** — an admin page listing flags (filter open / resolved / all),
  each with a **Resolve** action; a link to the flagged question.
- An **open-flag count** link on the existing `/admin` page.
- Docs sync + a `post-feedback` git tag.

### Out of scope
- Editing/regenerating a flagged question — the admin disables it via the
  existing #6 toggle on the question detail page.
- Notifying users when their flag is resolved.
- Rating questions (thumbs up/down) or rating the app — flagging problems only.
- Rate-limiting / dedup of flags (a user may file more than one) — YAGNI for a
  small personal app.
- Automated test runner — verification is `type-check` + `lint` + `build` + MCP SQL.

### Acceptance criteria
1. `pnpm type-check`, `pnpm lint`, `pnpm build` succeed.
2. `sat.question_flags` exists with RLS enabled and **no policies** (writes go
   through the definer RPC, admin reads through the service-role client).
3. `sat.submit_flag` exists, runs `security definer`, sets `user_id` from
   `auth.uid()`, and `authenticated` has `execute`.
4. A signed-in user can file a flag from a question review; it lands in
   `sat.question_flags` with `status = 'open'`.
5. `/admin/flags` lists flags (default: open), each linking to its question, and
   an admin can resolve a flag; resolving persists and the list reflects it.
6. A non-admin gets a 404 on `/admin/flags`.
7. `/admin` shows the open-flag count and links to `/admin/flags`.

## 3. Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| A1 | Flagging is offered from **`ReviewItem`** (via a `FlagQuestion` widget), not from inside the live test. | `ReviewItem` is the one component shown in *both* the post-submit results review and the saved-attempt review (`/dashboard/attempts/[id]`); adding the widget there covers every place a user inspects a question, and never interrupts a test in progress. |
| A2 | User writes go through a **`security definer` RPC `submit_flag`**; `question_flags` has RLS enabled with **no policies**. | Mirrors `save_attempt` (#4): the RPC sets `user_id := auth.uid()` so the client cannot spoof an identity, and no-policy RLS denies all direct table access. The user never reads flags back, so no select policy is needed either. |
| A3 | Admin flag reads and the resolve write go through the **service-role client behind `requireAdmin()`**. | Mirrors #6's `setQuestionEnabled`. An RLS "admins see all" policy would need a `sat.profiles` sub-query; the service-role-behind-`requireAdmin()` pattern is already established, simpler, and the `/admin` subtree is already role-gated. |
| A4 | `reason` is a **fixed enum** (`wrong_answer`, `unclear`, `typo`, `other`) enforced by a table `CHECK`; `comment` is optional free text. | A small fixed taxonomy keeps flags triageable; a free-text comment captures specifics. The `CHECK` is the backstop; the server action also zod-validates. |
| A5 | The admin resolves a flag and (separately) disables the question via #6's existing toggle — **no combined "disable & resolve" action**. | Resolving a flag and disabling a question are distinct decisions (a flag can be resolved as "not a real problem"). Reusing #6's toggle keeps #7 small; the flag row links to the question detail where the toggle lives. |

## 4. Data model

```sql
-- supabase/migrations/20260521080000_sat_question_flags.sql

create table if not exists sat.question_flags (
  id           uuid primary key default gen_random_uuid(),
  question_id  text not null references sat.questions (id) on delete cascade,
  user_id      uuid not null references auth.users (id)   on delete cascade,
  reason       text not null check (reason in ('wrong_answer','unclear','typo','other')),
  comment      text,
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

The `reason` `CHECK` and the `question_id` FK make a malformed flag fail the
insert; the FK guarantees a flag always points at a real pool question.

## 5. Application structure

```
supabase/migrations/20260521080000_sat_question_flags.sql   # CREATED
app/lib/feedback/actions.ts     # CREATED: submitFlag server action (+ zod schema)
app/components/FlagQuestion.tsx # CREATED: 'use client' flag widget
app/components/ReviewItem.tsx   # MODIFIED: render <FlagQuestion questionId={question.id} />
app/lib/admin/flags.ts          # CREATED: listFlags / countOpenFlags + QuestionFlag type
app/lib/admin/actions.ts        # MODIFIED: + resolveFlag action
app/components/admin/FlagRow.tsx            # CREATED: a flag row + Resolve form
app/(app)/admin/flags/page.tsx              # CREATED: the flags page
app/(app)/admin/page.tsx                    # MODIFIED: + open-flag count link
README.md / CLAUDE.md                       # MODIFIED
```

### 5.1 `feedback/actions.ts`
`'use server'`. A zod schema validates `{ questionId, reason ∈ enum, comment ≤
500 chars }`. `submitFlag(input)` → validate → call
`supabase.schema('sat').rpc('submit_flag', …)` via the SSR client → return
`{ ok: true } | { ok: false; error }`.

### 5.2 `FlagQuestion.tsx`
`'use client'`. Props `{ questionId: string }`. Collapsed by default as a small
"Report a problem" link. Expanded: a reason `<select>`, an optional comment
`<textarea>` (max 500), Submit + Cancel. Holds `open` / `idle|submitting|done|
error` state; on submit calls `submitFlag`; on success shows a "Thanks —
reported" line. Self-contained — no props beyond `questionId`.

### 5.3 `ReviewItem.tsx`
One added line: `<FlagQuestion questionId={question.id} />` after the
explanation block. `ReviewItem` is already `'use client'`, so importing the
client widget is fine. `question.id` is always a real `sat.questions` id (pool
draw or seed fallback), satisfying the flag FK.

### 5.4 `admin/flags.ts`
Admin-only reads via the service-role client (`question_flags` has no RLS
policy). `FlagStatus = 'open' | 'resolved'`. `QuestionFlag` carries the flag
fields plus the joined `question_prompt` / `question_section` /
`question_enabled`.
- `listFlags(status: FlagStatus | 'all')` — two queries: the flags (filtered,
  `order by created_at desc`, `limit 200`), then the referenced `sat.questions`
  rows, merged in JS (the flag list is small; this avoids an embed).
- `countOpenFlags()` — a `head: true, count: 'exact'` count of open flags.

### 5.5 `admin/actions.ts` — `resolveFlag`
`resolveFlag(flagId: string)` — `await requireAdmin()` (returns the admin
`Profile`), then a service-role `update question_flags set status='resolved',
resolved_at=now(), resolved_by=<admin id>` ; `revalidatePath('/admin/flags')`
and `'/admin'`.

### 5.6 Pages & components
- **`(app)/admin/flags/page.tsx`** — under the existing `(app)/admin/layout.tsx`
  role gate. Reads `searchParams` (`Promise<{ status? }>`), defaults to `open`,
  calls `listFlags`. Renders a back link, a heading, status filter links, and
  the `FlagRow` list (empty state when none).
- **`FlagRow.tsx`** — server component. A reason badge, the (truncated) question
  prompt, the comment (if any), the date, a "Question disabled" badge if the
  question is already disabled, a **View question** link to
  `/admin/questions/[id]`, and — for an open flag — a **Mark resolved** form
  bound to `resolveFlag`.
- **`(app)/admin/page.tsx`** — gains `countOpenFlags()` in its parallel fetch and
  renders a link: "*N* open flag(s) →" to `/admin/flags`.

## 6. Security
- `question_flags` has RLS enabled and **no policies** — no `authenticated` role
  can read or write it directly. Users write only via `submit_flag` (definer,
  identity from `auth.uid()`); admins read/resolve only via the service-role
  client, and only behind `requireAdmin()`.
- `/admin/flags` is under `(app)/admin/layout.tsx` — the same double gate (#6)
  as the rest of `/admin`; `resolveFlag` re-checks `requireAdmin()`.
- The service-role key stays server-only; `FlagQuestion` (client) calls only the
  `submitFlag` server action, which uses the ordinary SSR client + the RPC.
- The server action zod-validates; the table `CHECK` constraints are the backstop.

## 7. Verification
- `pnpm type-check`, `pnpm lint`, `pnpm build` clean.
- MCP SQL: `question_flags` exists, RLS enabled, zero policies; `submit_flag`
  exists with `prosecdef = true`; after a test flag is filed, the row is present
  with `status = 'open'`; after a resolve, `status = 'resolved'` with
  `resolved_at`/`resolved_by` set.
- Manual: a user files a flag from a review; an admin sees it on `/admin/flags`,
  resolves it; a non-admin 404s on `/admin/flags`.

## 8. Next steps
Spec review → `superpowers:writing-plans` → `superpowers:subagent-driven-development`
→ commits on `main`, tag `post-feedback`. This is the seventh and final
sub-project.
