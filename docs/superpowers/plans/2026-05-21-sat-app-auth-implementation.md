# SAT-App Auth Sub-Project Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the SAT practice app behind sign-in — email/password and Google OAuth on `@supabase/ssr` — so every test belongs to a known user.

**Architecture:** Adapt the OneReal `@supabase/ssr` + middleware pattern. A root `middleware.ts` refreshes the session and redirects unauthenticated requests to `/login`. Auth pages live in an `(auth)` route group; the two authenticated pages move into an `(app)` route group with a shared header. A `sat.profiles` table (RLS, column-scoped grants) stores per-user data; rows are created by application code (`getOrCreateProfile`), **not** a trigger on the shared `auth.users`.

**Tech Stack:** Next.js 15 · React 19 · TypeScript (strict) · pnpm · `@supabase/ssr` · `@supabase/supabase-js` · react-hook-form · zod · `@hookform/resolvers` · Tailwind + shadcn/ui.

**Spec:** [2026-05-21-sat-app-auth-design.md](../specs/2026-05-21-sat-app-auth-design.md)

**Builds on:** the Foundation sub-project, tagged `post-foundation`. Lands seven commits on `main`, tagged `post-auth`.

**Verification model:** No automated tests (spec Decision A12, matching Foundation D8). Each task's gate is `pnpm type-check` (plus `pnpm build` where routes change). The spec §10 checklist runs at Task 7.

**Shell:** Windows / PowerShell 5.1 is canonical. Paths containing `(` `)` (route groups) MUST be quoted in PowerShell and bash alike.

---

## ⚠️ External setup required (stakeholder, in the Supabase dashboard)

Three tasks depend on configuration that cannot be done from code. The stakeholder performs these on the **Property Ledger** Supabase project (`falgykkspbtrwdcchayi`); see spec §8 for full detail. The controller surfaces this checklist before Task 7.

1. **Expose the `sat` schema** — Settings → API → Exposed Schemas → add `sat`. **Required for Tasks 6–7** (the app reads `sat.profiles` through PostgREST).
2. **Google provider** — create a Google Cloud OAuth client (redirect URI `https://falgykkspbtrwdcchayi.supabase.co/auth/v1/callback`), then Authentication → Providers → Google → enable + paste client ID/secret. Required for the Google button to work.
3. **Confirm email OFF** + **URL config** — Authentication → Providers → Email: "Confirm email" off; Authentication → URL Configuration: Site URL `http://localhost:3000`, redirect allow-list includes `http://localhost:3000/**`.

Email/password auth works once #3 is done; Google works once #2 is done; profile reads work once #1 is done.

---

## Plan-wide File Structure

Target tree at the end of all tasks. Everything from `post-foundation` not listed here is unchanged.

```
sat-app/
├── package.json                              # MODIFIED (Task 2: + @hookform/resolvers)
├── pnpm-lock.yaml                            # MODIFIED (Task 2)
├── middleware.ts                             # CREATED (Task 5)
├── README.md                                 # MODIFIED (Task 7)
├── CLAUDE.md                                 # MODIFIED (Task 7)
│
├── supabase/migrations/
│   └── 20260521010000_sat_profiles.sql       # CREATED (Task 1)
│
├── app/
│   ├── layout.tsx                            # UNCHANGED (root: html/body/Providers)
│   │
│   ├── (auth)/
│   │   ├── layout.tsx                        # CREATED (Task 3)
│   │   ├── login/page.tsx                    # CREATED (Task 3)
│   │   ├── register/page.tsx                 # CREATED (Task 3)
│   │   ├── forgot-password/page.tsx          # CREATED (Task 4)
│   │   └── reset-password/page.tsx           # CREATED (Task 4)
│   │
│   ├── auth/callback/route.ts                # CREATED (Task 4)
│   │
│   ├── (app)/
│   │   ├── layout.tsx                        # CREATED (Task 6)
│   │   ├── page.tsx                          # MOVED from app/page.tsx + rewritten (Task 6)
│   │   └── dashboard/page.tsx                # MOVED from app/dashboard/page.tsx + rewritten (Task 6)
│   │
│   ├── components/
│   │   ├── AppHeader.tsx                     # CREATED (Task 6)
│   │   ├── SatPractice.tsx                   # MODIFIED (Task 6: studentName prop)
│   │   └── StartScreen.tsx                   # MODIFIED (Task 6: name field removed)
│   │
│   ├── hooks/useTestSession.ts               # MODIFIED (Task 6: initialName arg)
│   │
│   └── lib/auth/
│       ├── schemas.ts                        # CREATED (Task 2)
│       ├── actions.ts                        # CREATED (Task 2)
│       └── profile.ts                        # CREATED (Task 2)
│
└── docs/superpowers/plans/
    └── 2026-05-21-sat-app-auth-implementation.md   # this file
```

---

## Chunk 1: Database + auth library

Two commits. After Chunk 1 the `sat.profiles` table exists and the auth library (zod schemas, sign-out action, profile helper) is in place. No UI yet; the app still runs exactly as `post-foundation`.

### Task 1: `sat.profiles` migration

**Files:**
- Create: `supabase/migrations/20260521010000_sat_profiles.sql`

**Why this task exists:** Every later task reads or writes `sat.profiles`. The table, its RLS, and its column-scoped grants (which block a user from setting their own `role`) must exist first.

- [ ] **Step 1.1:** Create the migration file.

  Create `supabase/migrations/20260521010000_sat_profiles.sql` with EXACTLY this content:
  ```sql
  -- Auth sub-project — sat.profiles.
  -- Profile rows are created by application code (getOrCreateProfile), NOT by a
  -- trigger on auth.users: the Property Ledger Supabase project is shared with the
  -- PropLedger app, so a trigger on the shared auth.users would fire for non-SAT
  -- sign-ups. App-code creation keeps the SAT app confined to the sat schema.

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

- [ ] **Step 1.2:** Commit the migration file.

  ```powershell
  git add supabase/migrations/20260521010000_sat_profiles.sql
  git status --short
  ```
  Expected: only `A supabase/migrations/20260521010000_sat_profiles.sql`.
  ```powershell
  git commit -m @'
  feat(auth): sat.profiles migration

  Creates sat.profiles (id FK auth.users, email, full_name, avatar_url,
  role, timestamps) with RLS — a user reads/writes only their own row.
  Column-scoped grants block users from setting their own role (no
  escalation). No trigger on the shared auth.users; rows are created by
  app code (getOrCreateProfile).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  '@
  ```
  *(PowerShell here-string: the closing `'@` must be at column 0. Bash equivalent: `git commit -m "$(cat <<'EOF' … EOF)"`.)*

- [ ] **Step 1.3 — CONTROLLER ACTION (not the implementer):** Apply + verify the migration.

  The implementer subagent only writes and commits the file. The **controller** applies it to the database via the Supabase MCP (the proven Foundation Task 8 path) and verifies:
  - `mcp__claude_ai_Supabase__apply_migration` — project `falgykkspbtrwdcchayi`, name `sat_profiles`, query = the SQL from Step 1.1.
  - Verify with `mcp__claude_ai_Supabase__execute_sql`:
    ```sql
    select
      (select count(*) from pg_tables where schemaname='sat' and tablename='profiles') as table_exists,
      (select relrowsecurity from pg_class where oid='sat.profiles'::regclass) as rls_enabled,
      (select count(*) from pg_policies where schemaname='sat' and tablename='profiles') as policy_count;
    ```
    Expected: `table_exists=1`, `rls_enabled=true`, `policy_count=3`.
  - Verify `role` is NOT user-writable:
    ```sql
    select privilege_type, column_name
    from information_schema.column_privileges
    where table_schema='sat' and table_name='profiles' and grantee='authenticated'
      and column_name='role';
    ```
    Expected: **zero rows** (no `INSERT`/`UPDATE` privilege on `role` for `authenticated`).

### Task 2: Auth library — deps, zod schemas, sign-out action, profile helper

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (add `@hookform/resolvers`)
- Create: `app/lib/auth/schemas.ts`
- Create: `app/lib/auth/actions.ts`
- Create: `app/lib/auth/profile.ts`

**Why this task exists:** The auth pages (Tasks 3–4) need validation schemas; the header (Task 6) needs the sign-out action and the profile helper. Landing them first keeps later tasks focused on UI.

- [ ] **Step 2.1:** Install `@hookform/resolvers`.

  ```powershell
  pnpm add @hookform/resolvers
  ```
  Expected: install succeeds; `package.json` `dependencies` gains `@hookform/resolvers`; `pnpm-lock.yaml` updates. `react-hook-form` and `zod` are already present from Foundation.

- [ ] **Step 2.2:** Create `app/lib/auth/schemas.ts`.

  ```powershell
  New-Item -ItemType Directory -Force app/lib/auth | Out-Null
  ```
  Create `app/lib/auth/schemas.ts` with EXACTLY this content (note: zod 4 idiom `z.email()`, not `z.string().email()`):
  ```ts
  import { z } from 'zod';

  export const loginSchema = z.object({
    email: z.email('Enter a valid email address'),
    password: z.string().min(1, 'Password is required'),
  });
  export type LoginValues = z.infer<typeof loginSchema>;

  export const registerSchema = z
    .object({
      fullName: z.string().min(1, 'Name is required'),
      email: z.email('Enter a valid email address'),
      password: z.string().min(8, 'Password must be at least 8 characters'),
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    });
  export type RegisterValues = z.infer<typeof registerSchema>;

  export const forgotPasswordSchema = z.object({
    email: z.email('Enter a valid email address'),
  });
  export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

  export const resetPasswordSchema = z
    .object({
      password: z.string().min(8, 'Password must be at least 8 characters'),
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    });
  export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
  ```

- [ ] **Step 2.3:** Create `app/lib/auth/actions.ts`.

  ```ts
  'use server';

  import { redirect } from 'next/navigation';
  import { createClient } from '@/app/lib/supabase/server';

  // Server action: clears the Supabase session cookie and returns to /login.
  export async function signOut() {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect('/login');
  }
  ```

- [ ] **Step 2.4:** Create `app/lib/auth/profile.ts`.

  ```ts
  import { cache } from 'react';
  import { createClient } from '@/app/lib/supabase/server';

  export interface Profile {
    id: string;
    email: string | null;
    full_name: string | null;
    avatar_url: string | null;
    role: 'student' | 'admin';
    created_at: string;
    updated_at: string;
  }

  // Returns the signed-in user's sat.profiles row, creating it on first access.
  // Wrapped in cache() so the layout's <AppHeader/> and the page component
  // collapse to a single execution per request. NOTE: requires the `sat` schema
  // to be exposed in the Supabase project's API settings (spec §8).
  export const getOrCreateProfile = cache(async (): Promise<Profile | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const sat = supabase.schema('sat');

    const { data: existing } = await sat
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (existing) return existing as Profile;

    const meta = user.user_metadata ?? {};
    const { data: created, error } = await sat
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email ?? null,
        full_name: meta.full_name ?? meta.name ?? null,
        avatar_url: meta.avatar_url ?? null,
      })
      .select('*')
      .single();

    if (error) {
      // A concurrent first-load may have inserted the row; re-select.
      const { data: row } = await sat
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      return (row as Profile) ?? null;
    }
    return created as Profile;
  });
  ```

- [ ] **Step 2.5:** Type-check.

  ```powershell
  pnpm type-check
  ```
  Expected: zero errors. If `supabase.schema('sat').from('profiles')` produces a typing complaint, the `as Profile` casts already in the code resolve it — do not add `// @ts-expect-error`.

- [ ] **Step 2.6:** Commit.

  ```powershell
  git add package.json pnpm-lock.yaml app/lib/auth/
  git status --short
  ```
  Expected: `M package.json`, `M pnpm-lock.yaml`, `A app/lib/auth/schemas.ts`, `A app/lib/auth/actions.ts`, `A app/lib/auth/profile.ts`.
  ```powershell
  git commit -m @'
  feat(auth): auth library — schemas, sign-out action, profile helper

  - @hookform/resolvers installed (bridges react-hook-form + zod)
  - zod schemas for login/register/forgot/reset forms
  - signOut server action
  - getOrCreateProfile: cache()-wrapped helper that reads/creates the
    signed-in user's sat.profiles row

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  '@
  ```

**Chunk 1 exit criteria:** `sat.profiles` exists in the database with verified RLS + column grants. The auth library type-checks. Two new commits. The app still runs as `post-foundation` (no UI change yet).

---

## Chunk 2: Auth pages

Two commits. After Chunk 2 the `(auth)` route group renders `/login`, `/register`, `/forgot-password`, `/reset-password`, and `/auth/callback` handles OAuth. The app is **not yet gated** — middleware arrives in Chunk 3.

**Convention for all auth pages:** every page file starts with `'use client';`, builds its form with `react-hook-form` + `zodResolver`, uses the Foundation-vendored shadcn `Card`/`CardContent`/`Input`/`Label`/`Button`, renders field errors inline (`<p className="text-xs text-red-600">`) and API errors in a form-level box, and disables the submit button while `isSubmitting`.

### Task 3: `(auth)` layout + login + register

**Files:**
- Create: `app/(auth)/layout.tsx`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/register/page.tsx`

- [ ] **Step 3.1:** Create the auth route-group directory and layout.

  ```powershell
  New-Item -ItemType Directory -Force "app/(auth)/login", "app/(auth)/register" | Out-Null
  ```
  Create `app/(auth)/layout.tsx`:
  ```tsx
  import type { ReactNode } from 'react';

  export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              Digital SAT · Practice
            </span>
            <h1 className="mt-3 text-2xl font-semibold">SAT Practice Test</h1>
          </div>
          {children}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 3.2:** Create `app/(auth)/login/page.tsx`.

  ```tsx
  'use client';

  import { useState } from 'react';
  import Link from 'next/link';
  import { useRouter } from 'next/navigation';
  import { useForm } from 'react-hook-form';
  import { zodResolver } from '@hookform/resolvers/zod';
  import { createClient } from '@/app/lib/supabase/client';
  import { loginSchema, type LoginValues } from '@/app/lib/auth/schemas';
  import { Button } from '@/app/components/ui/button';
  import { Input } from '@/app/components/ui/input';
  import { Label } from '@/app/components/ui/label';
  import { Card, CardContent } from '@/app/components/ui/card';

  export default function LoginPage() {
    const router = useRouter();
    const [formError, setFormError] = useState<string | null>(null);
    const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

    async function onSubmit(values: LoginValues) {
      setFormError(null);
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      router.push('/');
      router.refresh();
    }

    async function signInWithGoogle() {
      setFormError(null);
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setFormError(error.message);
    }

    return (
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
          <p className="mb-5 text-sm text-slate-500">Welcome back. Sign in to start practicing.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
              {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
              {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
            </div>
            {formError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <Button type="button" variant="secondary" className="w-full" onClick={signInWithGoogle}>
            Continue with Google
          </Button>

          <p className="mt-5 text-center text-sm text-slate-500">
            <Link href="/forgot-password" className="text-blue-600 hover:underline">
              Forgot your password?
            </Link>
          </p>
          <p className="mt-1 text-center text-sm text-slate-500">
            No account?{' '}
            <Link href="/register" className="text-blue-600 hover:underline">
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 3.3:** Create `app/(auth)/register/page.tsx`.

  ```tsx
  'use client';

  import { useState } from 'react';
  import Link from 'next/link';
  import { useRouter } from 'next/navigation';
  import { useForm } from 'react-hook-form';
  import { zodResolver } from '@hookform/resolvers/zod';
  import { createClient } from '@/app/lib/supabase/client';
  import { registerSchema, type RegisterValues } from '@/app/lib/auth/schemas';
  import { Button } from '@/app/components/ui/button';
  import { Input } from '@/app/components/ui/input';
  import { Label } from '@/app/components/ui/label';
  import { Card, CardContent } from '@/app/components/ui/card';

  export default function RegisterPage() {
    const router = useRouter();
    const [formError, setFormError] = useState<string | null>(null);
    const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

    async function onSubmit(values: RegisterValues) {
      setFormError(null);
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          data: { full_name: values.fullName },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      if (!data.session) {
        // Defensive: only reachable if email confirmation is later turned on.
        setFormError('Check your email to confirm your account before signing in.');
        return;
      }
      router.push('/');
      router.refresh();
    }

    async function signInWithGoogle() {
      setFormError(null);
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setFormError(error.message);
    }

    return (
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-1 text-lg font-semibold">Create your account</h2>
          <p className="mb-5 text-sm text-slate-500">Sign up to track your SAT practice.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" type="text" autoComplete="name" {...register('fullName')} />
              {errors.fullName && <p className="text-xs text-red-600">{errors.fullName.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
              {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
              />
              {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-red-600">{errors.confirmPassword.message}</p>
              )}
            </div>
            {formError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <Button type="button" variant="secondary" className="w-full" onClick={signInWithGoogle}>
            Continue with Google
          </Button>

          <p className="mt-5 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-600 hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 3.4:** Type-check.

  ```powershell
  pnpm type-check
  ```
  Expected: zero errors.

- [ ] **Step 3.5:** Commit.

  ```powershell
  git add "app/(auth)/layout.tsx" "app/(auth)/login/page.tsx" "app/(auth)/register/page.tsx"
  git status --short
  ```
  Expected: three `A` entries under `app/(auth)/`.
  ```powershell
  git commit -m @'
  feat(auth): (auth) route group with login and register pages

  Centered-card auth layout; email/password sign-in and sign-up forms
  (react-hook-form + zod) plus "Continue with Google". App not yet gated.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  '@
  ```

### Task 4: forgot-password, reset-password, OAuth callback

**Files:**
- Create: `app/(auth)/forgot-password/page.tsx`
- Create: `app/(auth)/reset-password/page.tsx`
- Create: `app/auth/callback/route.ts`

- [ ] **Step 4.1:** Create the directories.

  ```powershell
  New-Item -ItemType Directory -Force "app/(auth)/forgot-password", "app/(auth)/reset-password", "app/auth/callback" | Out-Null
  ```

- [ ] **Step 4.2:** Create `app/(auth)/forgot-password/page.tsx`.

  ```tsx
  'use client';

  import { useState } from 'react';
  import Link from 'next/link';
  import { useForm } from 'react-hook-form';
  import { zodResolver } from '@hookform/resolvers/zod';
  import { createClient } from '@/app/lib/supabase/client';
  import { forgotPasswordSchema, type ForgotPasswordValues } from '@/app/lib/auth/schemas';
  import { Button } from '@/app/components/ui/button';
  import { Input } from '@/app/components/ui/input';
  import { Label } from '@/app/components/ui/label';
  import { Card, CardContent } from '@/app/components/ui/card';

  export default function ForgotPasswordPage() {
    const [formError, setFormError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });

    async function onSubmit(values: ForgotPasswordValues) {
      setFormError(null);
      const supabase = createClient();
      // Route the reset link through /auth/callback so the PKCE `code` is
      // exchanged for a session before the user reaches the reset form.
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      setSent(true);
    }

    return (
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-1 text-lg font-semibold">Reset your password</h2>
          {sent ? (
            <p className="text-sm text-slate-600">
              If an account exists for that email, a password-reset link is on its way.
              Check your inbox.
            </p>
          ) : (
            <>
              <p className="mb-5 text-sm text-slate-500">
                Enter your email and we&apos;ll send you a reset link.
              </p>
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" {...register('email')} />
                  {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
                </div>
                {formError && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
                )}
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            </>
          )}
          <p className="mt-5 text-center text-sm text-slate-500">
            <Link href="/login" className="text-blue-600 hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 4.3:** Create `app/(auth)/reset-password/page.tsx`.

  ```tsx
  'use client';

  import { useState } from 'react';
  import { useRouter } from 'next/navigation';
  import { useForm } from 'react-hook-form';
  import { zodResolver } from '@hookform/resolvers/zod';
  import { createClient } from '@/app/lib/supabase/client';
  import { resetPasswordSchema, type ResetPasswordValues } from '@/app/lib/auth/schemas';
  import { Button } from '@/app/components/ui/button';
  import { Input } from '@/app/components/ui/input';
  import { Label } from '@/app/components/ui/label';
  import { Card, CardContent } from '@/app/components/ui/card';

  export default function ResetPasswordPage() {
    const router = useRouter();
    const [formError, setFormError] = useState<string | null>(null);
    const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) });

    async function onSubmit(values: ResetPasswordValues) {
      setFormError(null);
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) {
        setFormError(error.message);
        return;
      }
      router.push('/login');
    }

    return (
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-1 text-lg font-semibold">Set a new password</h2>
          <p className="mb-5 text-sm text-slate-500">Choose a new password for your account.</p>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
              />
              {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-red-600">{errors.confirmPassword.message}</p>
              )}
            </div>
            {formError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Update password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 4.4:** Create `app/auth/callback/route.ts`.

  ```ts
  import { NextResponse } from 'next/server';
  import { createClient } from '@/app/lib/supabase/server';

  // Exchanges the OAuth / email-link `code` for a session, then redirects
  // into the app. Used by Google sign-in and the password-reset email link.
  export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const next = searchParams.get('next') ?? '/';

    if (code) {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }
  ```

- [ ] **Step 4.5:** Type-check.

  ```powershell
  pnpm type-check
  ```
  Expected: zero errors.

- [ ] **Step 4.6:** Commit.

  ```powershell
  git add "app/(auth)/forgot-password/page.tsx" "app/(auth)/reset-password/page.tsx" "app/auth/callback/route.ts"
  git status --short
  git commit -m @'
  feat(auth): forgot-password, reset-password, OAuth callback

  resetPasswordForEmail + updateUser flows; /auth/callback exchanges the
  OAuth / email-link code for a session.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  '@
  ```

**Chunk 2 exit criteria:** all five auth routes exist and type-check. Four commits total so far. The app is still ungated.

---

## Chunk 3: Gating, app restructure, verification

Three commits. Middleware gates the app; the two authenticated pages move into an `(app)` group with a shared header; the gameplay reads the student name from the profile; final verification and the `post-auth` tag.

### Task 5: `middleware.ts` — session refresh + route gating

**Files:**
- Create: `middleware.ts` (project root)

**Why now:** the `/login` and other auth pages already exist (Tasks 3–4), so middleware can safely redirect to them without a 404/loop.

- [ ] **Step 5.1:** Create `middleware.ts` at the repo root.

  ```ts
  import { type NextRequest, NextResponse } from 'next/server';
  import { createServerClient } from '@supabase/ssr';

  const PUBLIC_PATHS = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/auth/callback',
  ];

  export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    // IMPORTANT: do no work between createServerClient and getUser().
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;
    const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

    if (!user && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }

    if (user && (path === '/login' || path === '/register')) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  }

  export const config = {
    matcher: [
      '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    ],
  };
  ```

- [ ] **Step 5.2:** Type-check and build.

  ```powershell
  pnpm type-check
  pnpm build
  ```
  Expected: both clean. (Do NOT run `pnpm dev` here — it blocks. Runtime gating is verified in Task 7.)

- [ ] **Step 5.3:** Commit.

  ```powershell
  git add middleware.ts
  git status --short
  git commit -m @'
  feat(auth): middleware session refresh + route gating

  Refreshes the Supabase session cookie every request; redirects
  unauthenticated traffic to /login and signed-in users away from
  /login and /register.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  '@
  ```

### Task 6: `(app)` route group, header, profile-name wiring

**Files:**
- Create: `app/(app)/layout.tsx`
- Create: `app/components/AppHeader.tsx`
- Move + rewrite: `app/page.tsx` → `app/(app)/page.tsx`
- Move + rewrite: `app/dashboard/page.tsx` → `app/(app)/dashboard/page.tsx`
- Modify: `app/components/SatPractice.tsx`
- Modify: `app/hooks/useTestSession.ts`
- Modify: `app/components/StartScreen.tsx`

- [ ] **Step 6.1:** Create the `(app)` directory and move the two pages (preserving git history).

  ```powershell
  New-Item -ItemType Directory -Force "app/(app)/dashboard" | Out-Null
  git mv app/page.tsx "app/(app)/page.tsx"
  git mv app/dashboard/page.tsx "app/(app)/dashboard/page.tsx"
  ```
  After this, `app/dashboard/` is empty — remove it if it lingers: `Remove-Item app/dashboard -Recurse -Force -ErrorAction SilentlyContinue`.

- [ ] **Step 6.2:** Create `app/components/AppHeader.tsx`.

  ```tsx
  import Link from 'next/link';
  import { getOrCreateProfile } from '@/app/lib/auth/profile';
  import { signOut } from '@/app/lib/auth/actions';
  import { Button } from '@/app/components/ui/button';

  // Server component. Shown on the authenticated pages via (app)/layout.tsx.
  export async function AppHeader() {
    const profile = await getOrCreateProfile();
    const displayName = profile?.full_name || profile?.email || 'Student';
    return (
      <header className="flex items-center justify-between border-b bg-white px-4 py-2.5 sm:px-5">
        <nav className="flex items-center gap-4">
          <Link href="/" className="font-semibold">
            SAT Practice
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-slate-500 transition-colors hover:text-slate-900"
          >
            Dashboard
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">{displayName}</span>
          <form action={signOut}>
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
    );
  }
  ```

- [ ] **Step 6.3:** Create `app/(app)/layout.tsx`.

  ```tsx
  import type { ReactNode } from 'react';
  import { AppHeader } from '@/app/components/AppHeader';

  export default function AppLayout({ children }: { children: ReactNode }) {
    return (
      <>
        <AppHeader />
        {children}
      </>
    );
  }
  ```

- [ ] **Step 6.4:** Replace `app/(app)/page.tsx` with the profile-aware version.

  Overwrite `app/(app)/page.tsx` with EXACTLY:
  ```tsx
  import SatPractice from '@/app/components/SatPractice';
  import { getOrCreateProfile } from '@/app/lib/auth/profile';

  export default async function Home() {
    const profile = await getOrCreateProfile();
    const studentName = profile?.full_name || profile?.email || 'Student';
    return <SatPractice studentName={studentName} />;
  }
  ```

- [ ] **Step 6.5:** Replace `app/(app)/dashboard/page.tsx` (drop the Foundation smoke test).

  Overwrite `app/(app)/dashboard/page.tsx` with EXACTLY:
  ```tsx
  import { getOrCreateProfile } from '@/app/lib/auth/profile';

  export default async function DashboardPage() {
    const profile = await getOrCreateProfile();
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-2 text-2xl font-bold">Your dashboard</h1>
        <p className="text-slate-600">
          Signed in as {profile?.full_name || profile?.email}.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Your test history and score trends will appear here once the
          Persistence sub-project lands.
        </p>
      </main>
    );
  }
  ```

- [ ] **Step 6.6:** Modify `app/hooks/useTestSession.ts` — accept an `initialName`.

  Change ONLY the function signature and the `name` state initializer. The signature line:
  ```ts
  export function useTestSession(): TestSession {
  ```
  becomes:
  ```ts
  export function useTestSession(initialName = ''): TestSession {
  ```
  And the line:
  ```ts
  const [name, setName] = useState('');
  ```
  becomes:
  ```ts
  const [name, setName] = useState(initialName);
  ```
  **Nothing else in this file changes.** Leave `start()` exactly as-is — it still calls `buildTest(trimmed, testLength)` and keeps the empty-name `window.alert` guard (now effectively dead code, since the name is always profile-populated; that is intentional — do not remove or rewrite it). The timer effect, `setTimeout` defer, and `eslint-disable` comment are untouched.

- [ ] **Step 6.7:** Modify `app/components/SatPractice.tsx` — accept and forward `studentName`.

  Change the component signature:
  ```tsx
  export default function SatPractice() {
    const s = useTestSession();
  ```
  to:
  ```tsx
  export default function SatPractice({ studentName }: { studentName: string }) {
    const s = useTestSession(studentName);
  ```
  Then, in the `screen === 'start'` branch, remove the `name` and `setName` props from `<StartScreen … />` (StartScreen no longer accepts them — Step 6.8). The branch becomes:
  ```tsx
    if (s.screen === 'start') {
      return (
        <StartScreen
          testLength={s.testLength}
          setTestLength={s.setTestLength}
          onStart={s.start}
        />
      );
    }
  ```
  The `test` and `results` branches are unchanged (they still pass `studentName={s.test.name}` etc.).

- [ ] **Step 6.8:** Modify `app/components/StartScreen.tsx` — remove the name field.

  Overwrite `app/components/StartScreen.tsx` with EXACTLY:
  ```tsx
  'use client';

  import type { TestLength } from '@/app/lib/test';
  import { Button } from '@/app/components/ui/button';
  import { Card, CardContent } from '@/app/components/ui/card';
  import { Label } from '@/app/components/ui/label';
  import { cn } from '@/app/lib/utils';

  interface StartScreenProps {
    testLength: TestLength;
    setTestLength: (l: TestLength) => void;
    onStart: () => void;
  }

  export function StartScreen({ testLength, setTestLength, onStart }: StartScreenProps) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16">
        <Card>
          <CardContent className="pt-6">
            <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 mb-3">
              Digital SAT · Practice
            </span>
            <h1 className="text-3xl font-semibold mb-1.5">SAT Practice Test</h1>
            <p className="text-slate-500 mb-6">
              A full timed practice run with Reading &amp; Writing and Math sections. Answer the questions,
              submit, and get an instant score with a worked explanation for every problem. Each new test
              pulls fresh, randomized questions.
            </p>

            <Label className="block text-sm font-semibold">Test length</Label>
            <div className="flex flex-wrap gap-2.5 mt-2 mb-[18px]">
              <Button
                variant="secondary"
                className={cn(testLength === 'short' ? 'ring-2 ring-blue-500 bg-blue-50' : '')}
                onClick={() => setTestLength('short')}
              >
                Quick (10 + 10, ~25 min)
              </Button>
              <Button
                variant="secondary"
                className={cn(testLength === 'full' ? 'ring-2 ring-blue-500 bg-blue-50' : '')}
                onClick={() => setTestLength('full')}
              >
                Full sections (all questions)
              </Button>
            </div>

            <div className="flex flex-wrap gap-2.5 mt-2">
              <Button onClick={onStart}>Start Test</Button>
            </div>
            <p className="text-sm text-slate-500 mt-3">
              Tip: the timer counts down per section, just like the real SAT. When time runs out, the
              section auto-advances.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  ```
  (The `Input` import is dropped because the name `<Input>` is gone.)

- [ ] **Step 6.9:** Type-check and build.

  ```powershell
  pnpm type-check
  pnpm build
  ```
  Expected: both clean. The build route list should still show `/` and `/dashboard` (now served from the `(app)` group) plus the auth routes.

- [ ] **Step 6.10:** Commit.

  ```powershell
  git add app/
  git status --short
  ```
  Expected: `A app/(app)/layout.tsx`, `A app/components/AppHeader.tsx`, renamed `app/page.tsx → app/(app)/page.tsx`, renamed `app/dashboard/page.tsx → app/(app)/dashboard/page.tsx`, `M app/components/SatPractice.tsx`, `M app/components/StartScreen.tsx`, `M app/hooks/useTestSession.ts`. No stray files.
  ```powershell
  git commit -m @'
  feat(auth): (app) route group, header, profile-name wiring

  - (app) route group holds / and /dashboard with a shared AppHeader
    (title, dashboard link, user name, sign out)
  - / and /dashboard read the signed-in user via getOrCreateProfile
  - StartScreen name field removed; the student name now comes from the
    profile and seeds useTestSession
  - dashboard Foundation smoke test removed

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  '@
  ```

### Task 7: Verification, docs, tag

**Files:**
- Modify: `README.md`, `CLAUDE.md`
- New tag: `post-auth`

- [ ] **Step 7.1 — PRE-REQUISITE:** Confirm the stakeholder has completed the §8 external setup (expose `sat` schema; Google provider; confirm-email off + URL config). Without the exposed `sat` schema, every authenticated page throws when `getOrCreateProfile` runs. The controller surfaces this and waits for confirmation before runtime verification.

- [ ] **Step 7.2:** Automated gates.

  ```powershell
  pnpm type-check
  pnpm lint
  pnpm build
  ```
  All three: zero errors.

- [ ] **Step 7.3:** Runtime gating checks (controller; dev server in background).

  Start `pnpm dev`, then:
  - `curl` `/` with no cookies → expect a redirect (3xx) to `/login`.
  - `curl` `/login` → expect 200.
  - `curl` `/register`, `/forgot-password`, `/reset-password` → each 200.

- [ ] **Step 7.4:** Manual auth click-through (run the spec §10 checklist).

  Register → lands on `/` with no name field; sign out → `/login`; sign in → `/`; wrong password → inline error; (after §8 #2) Google sign-in; forgot/reset password; confirm a `sat.profiles` row exists for the user; confirm gameplay (timer, scoring, review) is unchanged and the profile name shows in the TopBar / results.

- [ ] **Step 7.5:** Update `README.md` and `CLAUDE.md`.

  - `README.md`: add an "Authentication" section — the app requires sign-in; routes `/login` `/register` `/forgot-password` `/reset-password`; the §8 Supabase setup; `.env.local` already carries the Supabase vars from Foundation.
  - `CLAUDE.md`: add auth gotchas — (a) the `sat` schema must be exposed in Supabase API settings or `getOrCreateProfile` fails; (b) `sat.profiles.role` is not user-writable (column-scoped grants) — promote admins via direct DB update; (c) profile rows are created by `getOrCreateProfile`, deliberately NOT a trigger on the shared `auth.users`; (d) middleware gates everything except `PUBLIC_PATHS`.

- [ ] **Step 7.6:** Commit docs.

  ```powershell
  git add README.md CLAUDE.md
  git commit -m @'
  docs(auth): sync README and CLAUDE.md for the Auth sub-project

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  '@
  ```

- [ ] **Step 7.7:** Tag `post-auth`.

  ```powershell
  git tag post-auth
  git tag --list
  git diff post-foundation..post-auth --stat
  ```
  Expected: `post-auth` listed alongside `pre-ts-migration` and `post-foundation`; the diff is the entire Auth sub-project.

**Chunk 3 exit criteria:** three commits (middleware, app restructure, docs). The app is gated; sign-in/up/out and Google all work; `sat.profiles` is populated per user; `post-auth` tagged. Spec §10 criteria pass.

---

## Plan Complete

Seven commits land on `main` after the spec commit:

1. `sat.profiles` migration (Task 1)
2. Auth library — schemas, action, profile helper (Task 2)
3. `(auth)` group — login + register (Task 3)
4. forgot/reset password + OAuth callback (Task 4)
5. `middleware.ts` gating (Task 5)
6. `(app)` group + header + profile-name wiring (Task 6)
7. README/CLAUDE.md sync (Task 7)

Plus the `post-auth` tag.
