# SAT Prep — Auth Sub-Project Design

**Date:** 2026-05-21
**Status:** Approved for plan-writing
**Sub-project:** #3 of 7 — Auth
**Audience:** Future implementer (human or AI) building authentication
**Builds on:** Foundation sub-project (#1), tagged `post-foundation`

---

## 1. Context: where this fits

The Foundation sub-project (#1) is complete and tagged `post-foundation`. The SAT app now runs on TypeScript + Next.js 15 + React 19 + pnpm + Tailwind/shadcn, with `SatPractice` decomposed into a `useTestSession` hook + pure `lib/test.ts` + presentational components. Foundation also wired the `@supabase/ssr` browser/server clients, installed `react-hook-form` + `zod` + `@tanstack/react-query` (unused so far), and created an empty `sat` PostgreSQL schema with a deny-by-default RLS posture in the **Property Ledger** Supabase project (`falgykkspbtrwdcchayi`).

Today the app has no accounts: the StartScreen collects a free-text "name" and anyone can take a test. Nothing is persisted.

This sub-project (#3, Auth) adds authentication. Per the stakeholder decision, **the entire app is gated behind sign-in** — every test is performed by a known user. That is the prerequisite for the later sub-projects: Persistence (#4) saves each user's attempts, Analytics (#5) and Feedback (#7) report per user, Admin (#6) needs the `role` distinction. The stakeholder's framing: *"if we need to show reports, analytics etc for the user, we should know the user."*

The AI sub-project (#2) has **not** been built — Auth is being done before it. Auth and AI are independent; Auth depends only on Foundation. The hardcoded `BANK` in `app/lib/questions.ts` remains the question source, unchanged by this sub-project.

The reference implementation is the stakeholder's **OneReal** app (`C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal`): Next.js 15 App Router, `@supabase/ssr`, a session-refresh `middleware.ts`, an `(auth)` route group, email/password + Google OAuth, a `profiles` table, middleware route protection. This spec adapts that pattern and **drops OneReal's multi-tenant machinery** (organizations, `org_members`, role-based tenant routing, onboarding) — none of it applies to a single-user practice app.

---

## 2. Scope

### 2.1 In scope

- **One new dependency:** `@hookform/resolvers` (bridges `react-hook-form` ↔ `zod`, both already installed by Foundation). `@supabase/ssr` and `@supabase/supabase-js` are already present.
- **`sat.profiles` table** — columns `id`, `email`, `full_name`, `avatar_url`, `role`, `created_at`, `updated_at`; RLS enabled; column-scoped grants. Applied via the claude.ai Supabase MCP, like Foundation's schema migration.
- **`middleware.ts`** — refreshes the Supabase session cookie every request and enforces gating: unauthenticated → redirect to `/login`; authenticated user on `/login` or `/register` → redirect to `/`.
- **`(auth)` route group** with its own minimal layout (centered shadcn `Card`, no app chrome): `/login`, `/register`, `/forgot-password`, `/reset-password`.
- **`/auth/callback` route handler** — exchanges the OAuth / email-link `code` for a session (`exchangeCodeForSession`).
- **Email/password** sign-in (`signInWithPassword`) and sign-up (`signUp`); **Google OAuth** (`signInWithOAuth`).
- **zod schemas + react-hook-form** for every auth form; inline field-level error display.
- **`(app)` route group** holding the two authenticated pages (`/` and `/dashboard`) with a shared `(app)/layout.tsx` that renders a slim **app header** (app title, link to `/dashboard`, signed-in user's name, **Sign out**).
- **Sign-out** server action.
- **Profile name flows into gameplay:** the StartScreen free-text name field is removed; `app/(app)/page.tsx` (server) reads the signed-in user's profile and passes `studentName` into `<SatPractice/>`.
- **`/dashboard`:** Foundation's Supabase smoke test removed; the page shows the signed-in user (name + email) and a "test history coming soon" placeholder.
- **Docs sync** (`README.md`, `CLAUDE.md`) and a `post-auth` git tag.

### 2.2 Out of scope (explicitly deferred)

- **Required email confirmation.** Confirmation is OFF (stakeholder decision); sign-up creates a session immediately. It is a one-toggle Supabase dashboard change to enable later.
- **Admin UI.** The `role` column is created (a Foundation deferred decision — see §3), but `/admin` views are Admin sub-project (#6). No admin pages here.
- **Real test history.** `/dashboard` shows a placeholder; persisted attempts are Persistence sub-project (#4).
- **Account deletion, email-change verification, MFA, magic-link / passwordless, OAuth providers beyond Google.**
- **A user-facing profile/settings page.** Profile rows exist and carry the name; editing them is not in this sub-project.
- **Multi-tenant orgs / memberships / role-based routing** (OneReal has these; the SAT app does not need them).
- **Automated tests.** Verification is `pnpm type-check` + `pnpm lint` + `pnpm build` + curl-based gating checks + a manual auth click-through. Matches Foundation Decision D8.
- **Analytics, AI question generation.** Other sub-projects.

### 2.3 Acceptance criteria

After Auth completes:

1. `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm type-check`, `pnpm lint` all succeed.
2. An unauthenticated request to `/` or `/dashboard` is redirected to `/login`.
3. `/login`, `/register`, `/forgot-password`, `/reset-password` render without a session.
4. Registering with full name + email + password lands the user signed-in on `/`.
5. Signing in with email/password works; bad credentials show an inline error.
6. "Continue with Google" completes OAuth and returns the user signed-in on `/` (requires the dashboard setup in §8).
7. Forgot-password sends a reset email; the emailed link opens `/reset-password` and a new password can be set.
8. Sign-out returns the user to `/login`; the protected pages are unreachable afterward.
9. A `sat.profiles` row exists for each signed-in user, carrying their email and name; a user can read/update only their own row and cannot change their own `role`.
10. The gameplay StartScreen no longer has a name field; the timer/score/review behavior is otherwise unchanged from `post-foundation`.
11. `/dashboard` shows the signed-in user and a history placeholder; the Foundation smoke test is gone.

---

## 3. Architecture decisions (locked)

Made through brainstorming with the stakeholder on 2026-05-21. Rationale captured for future re-evaluation.

| # | Decision | Rationale |
|---|---|---|
| A1 | **Adapt the OneReal `@supabase/ssr` + middleware auth pattern.** Drop OneReal's multi-tenant machinery (organizations, `org_members`, role-based tenant routing, onboarding enforcement). | OneReal is the stakeholder's known-good reference and Foundation already staged exactly these libraries. The org/tenant model is irrelevant to a single-user practice app — carrying it would be pure over-engineering (YAGNI). |
| A2 | **Full gating.** `middleware.ts` redirects every unauthenticated request to `/login`; the whole app sits behind auth. | Stakeholder decision: per-user reports/analytics require every test to belong to a known user from day one. Simpler and more coherent than optional/anonymous auth. |
| A3 | **Email confirmation OFF.** `signUp` returns a session immediately and the user is dropped into the app. | Stakeholder decision: frictionless during development. It is a single Supabase dashboard toggle to require confirmation before real users (§8). |
| A4 | **Auth methods: email/password + Google OAuth only.** | Exactly what the stakeholder asked for ("user credentials or google authentication"). No other providers, no magic links. |
| A5 | **`react-hook-form` + `zod` for all auth forms** (with `@hookform/resolvers`). | Foundation explicitly installed RHF + zod and named the Auth sub-project as their first consumer. This is a deliberate, documented divergence from OneReal, which uses plain `useState` on its auth pages — RHF + zod gives proper inline validation and is the staged intent. |
| A6 | **`sat.profiles` rows are created by application code (ensure-on-first-load), NOT by a database trigger on `auth.users`.** | OneReal uses an `on_auth_user_created` trigger, but OneReal owns its Supabase project. The SAT app **shares** the Property Ledger project with the PropLedger app. A trigger on the shared `auth.users` would fire for *every* PropLedger sign-up and create junk `sat.profiles` rows, and couples the SAT app to shared infrastructure — undercutting Foundation's `sat`-schema isolation rationale (Foundation D2). App-code creation keeps everything the SAT app does inside the `sat` schema and only ever creates rows for actual SAT users. |
| A7 | **`sat.profiles` includes a `role text` column** (`'student'` \| `'admin'`, default `'student'`). | This is a Foundation deferred decision (Foundation spec §3, deferred-decisions table, row "#3"): the Auth sub-project adds `role`; Admin (#6) consumes it; admin promotion is a direct DB update for v1. Adding the column now (one line) avoids a later migration. No admin UI ships here. |
| A8 | **Users cannot set or change their own `role`.** Achieved with column-scoped `GRANT`s — `authenticated` gets `INSERT`/`UPDATE` only on `email, full_name, avatar_url` (and `INSERT` on `id`), never on `role`. | Table-wide `UPDATE` + an own-row RLS policy would let any user run `update sat.profiles set role='admin' where id = auth.uid()`. Column-scoped grants close that privilege-escalation hole at the SQL layer. Role changes are made by the `postgres`/service role only. |
| A9 | **Expose the `sat` schema to PostgREST.** The app reads `sat.profiles` via `supabase.schema('sat').from('profiles')`. | Supabase's API serves only the `public` schema by default (noted in Foundation Task 8). `sat.profiles` access — server and client — goes through PostgREST, so `sat` must be added to the project's Exposed Schemas. Safe: the `sat` deny-by-default posture plus `sat.profiles` RLS mean only authenticated users reach only their own row. |
| A10 | **`(app)` and `(auth)` route groups.** Authenticated pages (`/`, `/dashboard`) move under `app/(app)/` with a shared `(app)/layout.tsx` (app header); auth pages live under `app/(auth)/` with a card-shell layout. Route groups do not change URLs. | The standard Next.js App Router way to give one set of routes a header and another a bare layout. Matches OneReal's `(auth)`/`(dashboard)` structure. |
| A11 | **Slim header, no avatar dropdown.** The app header shows the title, a `/dashboard` link, the user's name, and a plain "Sign out" button — no avatar image, no dropdown menu. | YAGNI. OneReal's avatar + Radix dropdown is polish; a name + button needs no new Radix dependencies or vendored shadcn primitives. Easy to upgrade later. |
| A12 | **No automated tests** (matches Foundation D8). Verification is type-check + lint + build + curl gating checks + manual auth click-through. | Consistent with the project convention; a test runner is not justified by this sub-project's surface. |

---

## 4. Target file structure

Files **created** or **modified** by this sub-project. Everything else from `post-foundation` is unchanged.

```
sat-app/
├── package.json                            # MODIFIED: add @hookform/resolvers
├── pnpm-lock.yaml                           # MODIFIED
├── middleware.ts                            # CREATED: session refresh + route gating
├── README.md                               # MODIFIED: auth section
├── CLAUDE.md                                # MODIFIED: auth notes
│
├── app/
│   ├── layout.tsx                           # UNCHANGED (root: html/body/Providers)
│   │
│   ├── (auth)/
│   │   ├── layout.tsx                       # CREATED: centered card shell
│   │   ├── login/page.tsx                   # CREATED
│   │   ├── register/page.tsx                # CREATED
│   │   ├── forgot-password/page.tsx         # CREATED
│   │   └── reset-password/page.tsx          # CREATED
│   │
│   ├── auth/
│   │   └── callback/route.ts                # CREATED: OAuth / email-link code exchange
│   │
│   ├── (app)/
│   │   ├── layout.tsx                       # CREATED: renders <AppHeader/> + children
│   │   ├── page.tsx                         # MOVED from app/page.tsx; now reads profile
│   │   └── dashboard/page.tsx               # MOVED from app/dashboard/page.tsx; rewritten
│   │
│   ├── components/
│   │   ├── AppHeader.tsx                    # CREATED: title, nav, user name, sign-out
│   │   ├── SatPractice.tsx                  # MODIFIED: accepts studentName prop
│   │   ├── StartScreen.tsx                  # MODIFIED: name field removed
│   │   └── …                                # other gameplay components UNCHANGED
│   │
│   ├── hooks/
│   │   └── useTestSession.ts                # MODIFIED: accepts initialName argument
│   │
│   └── lib/
│       ├── supabase/{client,server}.ts      # UNCHANGED (created by Foundation)
│       └── auth/
│           ├── schemas.ts                   # CREATED: zod schemas for the 4 forms
│           ├── actions.ts                   # CREATED: 'use server' signOut()
│           └── profile.ts                   # CREATED: getOrCreateProfile() server helper
│
├── supabase/
│   └── migrations/
│       └── 20260521010000_sat_profiles.sql  # CREATED: sat.profiles table + RLS + grants
│
└── docs/superpowers/
    ├── specs/
    │   └── 2026-05-21-sat-app-auth-design.md            # this document
    └── plans/
        └── 2026-05-21-sat-app-auth-implementation.md    # written next
```

### Files removed / relocated

- `app/page.tsx` → `app/(app)/page.tsx` (`git mv`; URL `/` unchanged).
- `app/dashboard/page.tsx` → `app/(app)/dashboard/page.tsx` (`git mv`; URL `/dashboard` unchanged), then rewritten (smoke test removed).

---

## 5. Implementation path (ordered steps)

Each numbered step is one logical commit. The order is chosen so the app is never in a redirect-loop: the `/login` page exists before `middleware.ts` starts redirecting to it.

### Step 1 — `sat.profiles` migration

Write `supabase/migrations/20260521010000_sat_profiles.sql` (full SQL in §6). Apply it to the Property Ledger project via `mcp__claude_ai_Supabase__apply_migration` (the proven Foundation path). Verify with `execute_sql`: the table exists, RLS is enabled, the three policies exist, and the column-scoped grants are in place (no `UPDATE`/`INSERT` privilege on `role` for `authenticated`).

### Step 2 — Auth lib: deps, schemas, helpers

- `pnpm add @hookform/resolvers`.
- `app/lib/auth/schemas.ts` — zod schemas: `loginSchema`, `registerSchema`, `forgotPasswordSchema`, `resetPasswordSchema` (§7.4). Use zod 4 idioms (`z.email()`).
- `app/lib/auth/actions.ts` — `'use server'` `signOut()`: server Supabase client → `auth.signOut()` → `redirect('/login')`.
- `app/lib/auth/profile.ts` — `getOrCreateProfile()` server helper (§6.3).

### Step 3 — `(auth)` layout + login + register

- `app/(auth)/layout.tsx` — centered shadcn `Card` shell, app wordmark, no header.
- `app/(auth)/login/page.tsx` — client component; RHF + `loginSchema`; email + password; inline errors; "Sign in" → `signInWithPassword` → `router.push('/')` + `router.refresh()`; "Continue with Google" → `signInWithOAuth`; links to `/register` and `/forgot-password`.
- `app/(auth)/register/page.tsx` — client component; RHF + `registerSchema`; full name + email + password + confirm; "Create account" → `signUp({ email, password, options: { data: { full_name }, emailRedirectTo: <origin>/auth/callback } })`; with confirmation off, a session is returned → `router.push('/')`; "Continue with Google"; link to `/login`.

The app is still reachable without auth at this step — gating arrives in Step 5.

### Step 4 — forgot-password, reset-password, OAuth callback

- `app/(auth)/forgot-password/page.tsx` — RHF + `forgotPasswordSchema`; `resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`; success state ("check your email").
- `app/(auth)/reset-password/page.tsx` — RHF + `resetPasswordSchema`; `updateUser({ password })` (the recovery session is established from the email link); on success → `/login`.
- `app/auth/callback/route.ts` — `GET` handler: read `code`, `await createClient()`, `exchangeCodeForSession(code)`; on success redirect to `next` (default `/`); on failure redirect to `/login?error=auth`.

### Step 5 — `middleware.ts` (gating)

Add `middleware.ts` at the project root (§7.1). Public paths: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`. Everything else requires a session. After this commit the app is gated.

### Step 6 — `(app)` route group, header, profile-name wiring

- Create `app/(app)/layout.tsx` rendering `<AppHeader/>` then `{children}`.
- `git mv app/page.tsx app/(app)/page.tsx`; `git mv app/dashboard/page.tsx app/(app)/dashboard/page.tsx`.
- `app/components/AppHeader.tsx` — server component: `getOrCreateProfile()`; renders title (link to `/`), a `/dashboard` link, the user's name, and a sign-out control (a client button bound to the `signOut` server action).
- `app/(app)/page.tsx` — server component: `getOrCreateProfile()` → `studentName = profile.full_name || user.email` → `<SatPractice studentName={studentName} />`.
- `app/components/SatPractice.tsx` — accept `studentName: string`; pass to `useTestSession(studentName)`.
- `app/hooks/useTestSession.ts` — `useTestSession(initialName: string)`; seed `useState(initialName)` for `name`. Everything else unchanged (timer, FSM, scoring untouched).
- `app/components/StartScreen.tsx` — remove the "Student name" `<Input>`/`<Label>` and the `name`/`setName` props; the screen now shows only the test-length toggle and Start button.
- `app/(app)/dashboard/page.tsx` — rewrite: remove the Foundation `auth.getSession()` smoke test; `getOrCreateProfile()`; show the user's name + email and a "Your test history will appear here once the Persistence sub-project lands" placeholder.

### Step 7 — Verification, docs, tag

- `pnpm type-check`, `pnpm lint`, `pnpm build` — all clean.
- Run the §10 verification checklist (curl gating checks + manual auth click-through).
- Update `README.md` (auth section: sign-in required, the `(auth)` routes, the §8 setup) and `CLAUDE.md` (auth gotchas: shared-project no-trigger rationale, `sat` exposed-schema requirement, `role` not user-writable).
- Tag `post-auth`.

---

## 6. Data model

### 6.1 `sat.profiles` migration — `supabase/migrations/20260521010000_sat_profiles.sql`

```sql
-- Auth sub-project — sat.profiles.
-- Profile rows are created by application code (getOrCreateProfile), NOT by a
-- trigger on auth.users: the Property Ledger Supabase project is shared with the
-- PropLedger app, so a trigger on the shared auth.users would fire for non-SAT
-- sign-ups. App-code creation keeps the SAT app confined to the sat schema
-- (Foundation Decision D2 / Auth Decision A6).

create table if not exists sat.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  role        text not null default 'student' check (role in ('student', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table sat.profiles enable row level security;

-- A user may read, create, and update only their own profile row.
create policy "profiles_select_own" on sat.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_own" on sat.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_own" on sat.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Foundation's deny-by-default revoked table privileges in the sat schema.
-- Grant them back COLUMN-SCOPED so authenticated users can never write `role`
-- (no role escalation): insert/update are limited to non-privileged columns.
grant select on sat.profiles to authenticated;
grant insert (id, email, full_name, avatar_url) on sat.profiles to authenticated;
grant update (email, full_name, avatar_url) on sat.profiles to authenticated;

-- updated_at maintenance (trigger on our own table — not shared infra).
create or replace function sat.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on sat.profiles
  for each row execute function sat.set_updated_at();
```

Notes:
- `on delete cascade` from `auth.users` removes the profile if the auth user is deleted.
- RLS plus column-scoped grants together: a user reaches only their own row (RLS) and can write only `email`/`full_name`/`avatar_url` (grants). `role`, `id`, `created_at`, `updated_at` are not user-writable. Admin promotion = a direct `update` by the `postgres`/service role (Foundation deferred decision; no UI here).
- The `set_updated_at` trigger is on `sat.profiles`, a table this project owns — unlike a trigger on the shared `auth.users`, this is fully isolated.

### 6.2 `Profile` TypeScript type

Declared in `app/lib/auth/profile.ts`:

```ts
export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: 'student' | 'admin';
  created_at: string;
  updated_at: string;
}
```

### 6.3 `getOrCreateProfile()` — application-side profile provisioning

`app/lib/auth/profile.ts` exports an async server helper. Behavior:

1. Build the server Supabase client; `auth.getUser()`. If no user, return `null`.
2. `select` the user's row from `sat.profiles` (`supabase.schema('sat').from('profiles').select('*').eq('id', user.id).maybeSingle()`).
3. If a row exists, return it.
4. Otherwise `insert` `{ id, email, full_name, avatar_url }` — `full_name`/`avatar_url` pulled from `user.user_metadata` (`full_name` ?? `name`; `avatar_url`). `role` is omitted (DB default `'student'`). Use `insert … select single` and treat a primary-key conflict as benign (a concurrent first-load won the race) by re-selecting the row.
5. Return the row.

This is the single place a `sat.profiles` row is born. It is called by `AppHeader`, `(app)/page.tsx`, and `(app)/dashboard/page.tsx` — every authenticated entry point — so the row reliably exists regardless of whether the user arrived via email sign-up, Google OAuth, or was created before this table existed. Most calls take the `select`-only fast path.

**The exported `getOrCreateProfile` MUST be wrapped in React's `cache()`** (`import { cache } from 'react'`). Within one authenticated page render, both `(app)/layout.tsx`'s `AppHeader` and the page component (`(app)/page.tsx` or `(app)/dashboard/page.tsx`) call it; `cache()` collapses those to a single execution per request, avoiding a redundant `select`/`insert` round trip.

---

## 7. Auth flows and components

### 7.1 `middleware.ts`

Standard `@supabase/ssr` middleware. It builds a request-scoped server client whose cookie adapter writes refreshed auth cookies onto the `NextResponse`, calls `auth.getUser()` **immediately** (no work between client creation and `getUser()` — required for correct cookie propagation), then applies gating:

- `PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/auth/callback']`.
- No user and path is not public → `redirect('/login')`.
- User present and path is `/login` or `/register` → `redirect('/')`.
- Otherwise return the (cookie-refreshed) response.

`config.matcher` excludes `_next/static`, `_next/image`, `favicon.ico`, and common image extensions so middleware runs only on real navigations.

### 7.2 Email/password

Both calls run **client-side** with the browser Supabase client (matches OneReal):

- **Sign in:** `supabase.auth.signInWithPassword({ email, password })`. On error, show the Supabase message inline. On success, `router.push('/')` + `router.refresh()` (so middleware re-evaluates with the new cookie).
- **Sign up:** `supabase.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: \`${location.origin}/auth/callback\` } })`. With confirmation OFF (A3), `data.session` is non-null → `router.push('/')`. The `full_name` is stored in `user_metadata` so `getOrCreateProfile()` can read it.

### 7.3 Google OAuth

- Button → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: \`${location.origin}/auth/callback\` } })`; the browser navigates to Google.
- Google returns to `/auth/callback?code=…`. The route handler exchanges the code for a session and redirects into the app. `getOrCreateProfile()` later reads Google's `full_name`/`avatar_url` from `user_metadata`.

### 7.4 Forms and zod schemas

`app/lib/auth/schemas.ts`:

- `loginSchema` — `email` (`z.email()`), `password` (`min(1)`).
- `registerSchema` — `fullName` (`min(1)`), `email`, `password` (`min(8)`), `confirmPassword`; `.refine` password === confirmPassword, error on `confirmPassword`.
- `forgotPasswordSchema` — `email`.
- `resetPasswordSchema` — `password` (`min(8)`), `confirmPassword`; `.refine` match.

Each page is a client component using `useForm` with `zodResolver(schema)`, built from the Foundation-vendored shadcn `Input` / `Label` / `Button`. Field errors render inline under each input; a form-level error region shows Supabase API errors. A `loading`/`isSubmitting` state disables the submit button during the request.

### 7.5 Header and sign-out

- `AppHeader.tsx` — server component; calls `getOrCreateProfile()`; renders the app title (link to `/`), a `/dashboard` link, the user's display name (`full_name || email`), and a sign-out button.
- The sign-out button is a tiny client component wrapping a `<form action={signOut}>` (or a button with `onClick`) bound to the `signOut` server action in `app/lib/auth/actions.ts`. `signOut()` clears the session server-side and `redirect('/login')`.

### 7.6 Gameplay integration

- `app/(app)/page.tsx` (server) resolves `studentName` from the profile and renders `<SatPractice studentName={studentName} />`.
- `SatPractice.tsx` forwards it to `useTestSession(studentName)`, which seeds the `name` state via `useState(initialName)`. `buildTest` still receives a name; nothing in the timer / FSM / scoring logic changes.
- `StartScreen.tsx` loses the name input and its `name`/`setName` props. The Start button and the Quick/Full toggle remain.
- **`useTestSession.start()` is otherwise left as-is.** It still calls `buildTest(name, testLength)` with the (now profile-seeded) `name` state value, and still contains the `const trimmed = name.trim(); if (!trimmed) { window.alert(...) }` guard. That guard becomes effectively dead code (the name is always populated from the profile) — leave it in place as a cheap safety net; do **not** rewrite `start()` to trim/validate or to read the prop directly, and do **not** remove the guard. The single change to the hook is the new `initialName` parameter and seeding `useState` from it.

---

## 8. External setup (Supabase dashboard + Google Cloud)

These are configuration tasks on the Property Ledger Supabase project that **cannot be done from code** and must be completed by the stakeholder. The implementer applies the SQL migration via MCP and provides this checklist; email/password auth works once items 3–4 are done, and Google works once items 1–2 are done.

1. **Google Cloud Console** — create an OAuth 2.0 Client ID (type: Web application). Authorized redirect URI: `https://falgykkspbtrwdcchayi.supabase.co/auth/v1/callback`. Copy the client ID and secret.
2. **Supabase → Authentication → Sign In / Providers → Google** — enable, paste the Google client ID + secret, save.
3. **Supabase → Authentication → Sign In / Providers → Email** — confirm **"Confirm email" is OFF** (matches A3).
4. **Supabase → Authentication → URL Configuration** — Site URL `http://localhost:3000`; Redirect URLs allow-list includes `http://localhost:3000/**` (add the production URL when deployed).
5. **Supabase → Settings → API → Exposed schemas** — add `sat` to the list (alongside `public`). Required for the app to read `sat.profiles` through PostgREST (A9).

If Google (1–2) is not yet configured, the "Continue with Google" button will return a provider error — email/password remains fully functional in the meantime.

---

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Migration touches the shared Property Ledger DB.** | Low | Medium | The migration is additive and confined to the `sat` schema (`create table sat.profiles`, policies, grants, one trigger on `sat.profiles`). It does **not** touch `auth.users` or any `public` object (A6 — no `auth.users` trigger). Reversible via `drop table sat.profiles`. Applied + verified via MCP, as Foundation's schema migration was. |
| **Role escalation: a user sets their own `role` to `admin`.** | Medium without mitigation | High | A8: column-scoped `GRANT`s — `authenticated` has no `INSERT`/`UPDATE` privilege on `role`. Verified in Step 1 (`execute_sql` against `information_schema.column_privileges`). |
| **Middleware redirect loop** (e.g. `/login` itself gets gated). | Low | High — app unusable | `/login` and the other auth routes are in `PUBLIC_PATHS`; `/auth/callback` is public too. Auth pages are built (Steps 3–4) before middleware (Step 5). Step 7 curl checks confirm `/login` returns 200 and `/` redirects. |
| **`sat` schema not exposed → app cannot read `sat.profiles`.** | Medium | High — every authenticated page fails | A9 + §8 item 5. `getOrCreateProfile()` surfaces a clear error if the schema is unexposed; the README and verification checklist call it out explicitly. |
| **Google OAuth not configured when the build is tested.** | High (until §8 done) | Low | Email/password is independent and fully testable without Google. The "Continue with Google" button degrades to a visible provider error, not a crash. §8 documents the exact setup. |
| **Next 15 async `cookies()` mishandled in middleware / callback.** | Low | Medium | Foundation already proved the `@supabase/ssr` server client against Next 15's async `cookies()`. Middleware uses the request/response cookie adapter (not `next/headers`); the callback route uses the existing Foundation server client. `pnpm type-check` catches an unawaited Promise. |
| **`(app)` route-group move breaks an import path.** | Low | Low | `git mv` preserves history; `@/app/components/...` alias imports are unaffected by the page's own location. `pnpm build` catches a broken path immediately. |
| **Email delivery (confirmation/reset) via Supabase's built-in service is rate-limited.** | Medium | Low | Confirmation is OFF (A3), so sign-up needs no email. Only forgot-password sends mail; Supabase's default service is adequate for development volume. A custom SMTP provider can be added later with no code change. |

---

## 10. Verification (run at Step 7)

Automated / scriptable:

- [ ] `pnpm type-check`, `pnpm lint`, `pnpm build` all report zero errors.
- [ ] `pnpm dev` starts; a curl to `/` with no cookie returns a redirect to `/login`.
- [ ] `/login`, `/register`, `/forgot-password`, `/reset-password` each return 200 with no session.
- [ ] `execute_sql`: `sat.profiles` exists, RLS enabled, the three policies present.
- [ ] `execute_sql` against `information_schema.column_privileges`: `authenticated` has **no** `INSERT`/`UPDATE` on `sat.profiles.role`.

Manual auth click-through:

- [ ] Register (full name + email + password) → lands signed-in on `/`; the StartScreen shows **no** name field.
- [ ] A `sat.profiles` row exists for the new user with the entered name and email.
- [ ] Sign out → redirected to `/login`; visiting `/` again redirects to `/login`.
- [ ] Sign in with the same email/password → back on `/`.
- [ ] Wrong password → inline error, no navigation.
- [ ] "Continue with Google" (after §8 setup) → completes and lands signed-in; the profile row carries the Google name.
- [ ] Forgot-password → reset email arrives; its link opens `/reset-password`; setting a new password succeeds and the new password signs in.
- [ ] Gameplay is unchanged from `post-foundation`: timer, color thresholds, scoring, review screen all behave identically; the student's name (from the profile) appears in the TopBar and on the results screen.
- [ ] `/dashboard` shows the signed-in user's name + email and the history placeholder; no Foundation smoke-test log appears.
- [ ] `README.md` documents the sign-in requirement and the §8 setup.

---

## 11. Glossary and references

- **Property Ledger Supabase project:** `falgykkspbtrwdcchayi` — shared with the PropLedger app; the SAT app lives under the `sat` schema. Accessible via the claude.ai Supabase MCP.
- **OneReal:** `C:\Users\AbishekPotlapalli\Desktop\Projects\Personal\OneReal` — the reference auth implementation (Next 15 + `@supabase/ssr` + middleware + `(auth)` group + Google OAuth + `profiles` table). This spec adapts its pattern and drops its multi-tenant layer.
- **Foundation spec:** `docs/superpowers/specs/2026-05-21-sat-app-foundation-design.md` — established the stack, the `sat` schema, the deny-by-default posture, and (in its deferred-decisions table) the `sat.profiles.role` column assigned to this sub-project.
- **Brainstorming session:** 2026-05-21, recorded in conversation history. Stakeholder approved: full gating, email confirmation off, email/password + Google, and the §1–§4 design.

---

## 12. Next steps after this spec is approved

1. Spec review loop (spec-document-reviewer subagent).
2. Invoke `superpowers:writing-plans` to produce the step-by-step implementation plan from the migration path in §5.
3. Execute the plan via `superpowers:subagent-driven-development` (per-task spec + code-quality review), landing the seven commits on `main` and tagging `post-auth`.
