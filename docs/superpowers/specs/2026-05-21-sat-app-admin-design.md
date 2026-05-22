# SAT Prep — Admin Sub-Project Design

**Date:** 2026-05-21
**Status:** Approved for plan-writing (autonomous build — design decisions made by the implementer per the stakeholder's standing instruction to proceed without per-step approval)
**Sub-project:** #6 of 7 — Admin
**Builds on:** Foundation (#1), Auth (#3), AI (#2), Persistence (#4), Analytics (#5, `post-analytics`)

---

## 1. Context

The AI sub-project (#2) generates SAT questions into `sat.questions` behind an
automated quality gate (zod shape + self-verify + dedup). That gate cannot catch
a question that is *well-formed but pedagogically poor* — its spec (G6)
explicitly flagged this as an accepted limitation needing human review later.

Auth (#3) created `sat.profiles` with a `role` column (`'student' | 'admin'`)
protected by the `protect_profile_role` trigger (a user cannot escalate their
own role).

This sub-project adds an **admin-only `/admin` area** to moderate the question
pool: browse every question (filterable), inspect it in full, and **disable** a
bad one so it is never served again. Disabling is a reversible soft-delete.

## 2. Scope

### In scope
- A **`sat.questions.enabled`** boolean column (default `true`); `sat.draw_questions`
  updated to serve only `enabled` questions.
- **`/admin`** — a role-gated question-pool moderation page: pool counts, section
  & status filters, a list of questions each with an enable/disable toggle.
- **`/admin/questions/[id]`** — full detail of one question (passage, choices with
  the correct answer marked, explanation, metadata) + the toggle.
- **`requireAdmin()`** guard; an `(app)/admin/layout.tsx` that 404s non-admins.
- **`setQuestionEnabled`** server action — admin-gated, writes via the
  service-role client.
- A conditional **Admin** link in `AppHeader` (shown only to admins).
- Docs sync + a `post-admin` git tag.

### Out of scope
- Hard-deleting questions (soft-disable only — reversible, preserves history).
- Editing question text (regeneration / correction) — disable is the only action.
- Admin views of users, attempts, or analytics across users.
- A feedback / flag-review queue — that is sub-project #7, which extends `/admin`.
- Pagination — the list is filterable and capped at 200 rows; the pool is small
  and pagination can be added later if it grows large.
- Automated test runner — verification is `type-check` + `lint` + `build` + MCP SQL.

### Acceptance criteria
1. `pnpm type-check`, `pnpm lint`, `pnpm build` succeed.
2. `sat.questions` has an `enabled boolean not null default true` column; every
   existing row is `enabled = true`.
3. `sat.draw_questions` never returns a disabled question (both the fresh and the
   recycle path filter `enabled = true`).
4. A non-admin visiting `/admin` or `/admin/questions/[id]` gets a 404.
5. An admin sees the pool list with counts, can filter by section and status, and
   can toggle a question's `enabled` state; the change persists and the list
   reflects it.
6. `AppHeader` shows an Admin link only when the signed-in user is an admin.

## 3. Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| A1 | **Soft-disable** via `sat.questions.enabled`, not hard delete. | Reversible, preserves the dedup history and any `served_questions`/`attempt_responses` foreign references, and lets an admin un-disable a mistake. A hard delete would cascade or orphan. |
| A2 | **`draw_questions` filters `enabled = true`** in both its fresh and recycle queries. | Disabling is meaningless if a disabled question still gets served. This is an additive change to the #2 RPC. `attempt_responses` snapshots the question, so already-saved attempts are unaffected. |
| A3 | **Role gating is page/layout + action level**, not middleware. | `middleware.ts` does not fetch the profile (only the session). An `(app)/admin/layout.tsx` calling `requireAdmin()` (which `notFound()`s non-admins) gates the whole subtree; each admin server action re-checks `requireAdmin()` as defence in depth. 404 (not 403) avoids confirming the route exists to non-admins. |
| A4 | **Admin writes go through a `requireAdmin()`-gated server action using the service-role client**, not a new RLS policy or a definer RPC. | `sat.questions` is intentionally RLS write-locked (#2). The service-role client (`app/lib/supabase/admin.ts`) already exists for privileged writes (the generation endpoint). A server action that first calls `requireAdmin()` then writes via that client is the established pattern — no new SQL, the role check is explicit and testable. Reads need nothing new: `sat.questions` already has a `select` policy `to authenticated using (true)`. |
| A5 | **Disable is the only moderation action; no inline editing.** | YAGNI for v1 — a bad AI question is removed from circulation by disabling; correcting it is regeneration's job. Keeps the sub-project focused. |

## 4. Data model

No new tables. One column + one function update:

```sql
-- supabase/migrations/20260521070000_sat_questions_enabled.sql
alter table sat.questions
  add column if not exists enabled boolean not null default true;

-- draw_questions, recreated to serve only enabled questions. Identical to the
-- #2 version except `and q.enabled` is added to the fresh and recycle queries.
create or replace function sat.draw_questions(p_section text, p_count int)
returns setof sat.questions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_count int  := least(greatest(coalesce(p_count, 0), 0), 60);
  v_ids   text[];
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id from sat.questions q
    where q.section = p_section
      and q.enabled
      and not exists (
        select 1 from sat.served_questions s
        where s.user_id = v_user and s.question_id = q.id)
    order by random()
    limit v_count
  ) fresh;

  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id
      from sat.questions q
      join sat.served_questions s
        on s.question_id = q.id and s.user_id = v_user
      where q.section = p_section
        and q.enabled
        and not (q.id = any(v_ids))
      order by s.served_at asc
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) recycled;
  end if;

  insert into sat.served_questions (user_id, question_id, served_at)
  select v_user, unnest(v_ids), now()
  on conflict (user_id, question_id) do update set served_at = excluded.served_at;

  return query select * from sat.questions q where q.id = any(v_ids);
end;
$$;

grant execute on function sat.draw_questions(text, int) to authenticated;
```

`returns setof sat.questions` automatically widens to include the new `enabled`
column; `rowToQuestion` ignores unknown columns, so gameplay is unaffected.

## 5. Application structure

```
supabase/migrations/20260521070000_sat_questions_enabled.sql   # CREATED
app/lib/admin/guard.ts     # CREATED: requireAdmin()
app/lib/admin/queries.ts   # CREATED: listQuestions / getQuestion / getPoolCounts + types
app/lib/admin/actions.ts   # CREATED: setQuestionEnabled server action
app/(app)/admin/layout.tsx                  # CREATED: role gate
app/(app)/admin/page.tsx                    # CREATED: pool list + filters + counts
app/(app)/admin/questions/[id]/page.tsx     # CREATED: question detail
app/components/admin/QuestionRow.tsx        # CREATED: list row + toggle form
app/components/AppHeader.tsx                # MODIFIED: conditional Admin link
README.md / CLAUDE.md                       # MODIFIED
```

### 5.1 `guard.ts`
`requireAdmin(): Promise<Profile>` — calls `getOrCreateProfile()`; if the profile
is missing or `role !== 'admin'`, calls `notFound()` (which is `never`, so the
return narrows to a non-null admin `Profile`). Used by the admin layout and every
admin server action.

### 5.2 `queries.ts`
Server-only, uses the SSR client (`sat.questions` is readable by any
`authenticated` user — its `select` policy is `using (true)`).
- `AdminQuestion` type — a full `sat.questions` row (incl. `enabled`, `source`,
  `created_at`).
- `PoolCounts` type — `{ total, enabled, disabled, ai, seed, rw, math }`.
- `QuestionFilters` — `{ section?: 'rw'|'math'; status?: 'enabled'|'disabled' }`.
- `listQuestions(filters)` — selects `sat.questions` with the filters applied,
  `order by created_at desc`, `limit 200`.
- `getQuestion(id)` — one row via `.eq('id', id).maybeSingle()`, `null` if absent.
- `getPoolCounts()` — selects `section, source, enabled` for all rows, counts in JS.

### 5.3 `actions.ts`
`'use server'`. `setQuestionEnabled(id: string, enabled: boolean): Promise<void>`
— `await requireAdmin()`, then `update sat.questions set enabled = …` via the
service-role client, then `revalidatePath('/admin')` and
`revalidatePath('/admin/questions/' + id)`. Throws on DB error.

### 5.4 Pages & components
- **`(app)/admin/layout.tsx`** — `await requireAdmin()` then render `children`.
- **`(app)/admin/page.tsx`** — server component, reads `searchParams`
  (`Promise<{ section?; status? }>`), validates them into `QuestionFilters`,
  fetches `getPoolCounts()` + `listQuestions(filters)`. Renders: a heading, a
  counts strip, filter links (section: All / Reading & Writing / Math; status:
  All / Enabled / Disabled — each a `<Link>` that sets the query string), and the
  list of `QuestionRow`s. Empty list → a short "no questions match" note.
- **`QuestionRow.tsx`** — server component. Shows section badge, `skill`, source
  badge, the truncated `prompt`, an enabled/disabled badge, a **View** link to
  the detail page, and a toggle: `<form action={setQuestionEnabled.bind(null,
  q.id, !q.enabled)}>` with a Disable/Enable button.
- **`(app)/admin/questions/[id]/page.tsx`** — server component, `params:
  Promise<{ id }>`; `getQuestion(id)` → `notFound()` if null. Renders the full
  question: metadata, passage (if any), prompt, every choice with the correct one
  marked, explanation, and the enable/disable toggle. Back link to `/admin`.
- **`AppHeader.tsx`** — after the existing links, `{profile?.role === 'admin' &&
  <Link href="/admin">Admin</Link>}`.

## 6. Security
- `/admin/*` is gated twice: the `(app)` group requires a session (middleware),
  and `admin/layout.tsx` requires `role === 'admin'` via `requireAdmin()`,
  `notFound()`-ing everyone else — a non-admin cannot even confirm the route.
- Every admin server action re-runs `requireAdmin()` before writing — the gate
  does not rely on UI reachability alone.
- The `role` column is already write-protected by the `protect_profile_role`
  trigger, so a user cannot make themselves an admin.
- The service-role key stays server-only (`app/lib/supabase/admin.ts`), used only
  inside the `'use server'` action — never shipped to the client.

## 7. Verification
- `pnpm type-check`, `pnpm lint`, `pnpm build` clean.
- MCP SQL: `sat.questions` has `enabled` (`not null default true`, all rows
  `true`); `draw_questions` body contains `q.enabled` in both queries; a
  disabled question is excluded from a `draw_questions` result.
- Manual: an admin account sees `/admin`, filters, toggles a question, and the
  state persists; a student account 404s on `/admin`.

## 8. Next steps
Spec review → `superpowers:writing-plans` → `superpowers:subagent-driven-development`
→ commits on `main`, tag `post-admin`. Sub-project #7 (Feedback) will extend
`/admin` with a flag-review queue.
