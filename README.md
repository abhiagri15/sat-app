# SAT Practice Test (Next.js)

A timed, replayable SAT-style practice test built with React (Next.js 15, App Router, React 19).
Sign in, take timed Reading & Writing and Math sections, submit, and get an instant
score with a worked explanation for every question. "Start a New Test" reshuffles fresh,
randomized questions and answer order.

## Authentication

The app requires sign-in. Every page is gated behind authentication — unauthenticated
requests are redirected to `/login` by `middleware.ts`.

Auth routes (no session required):

| Route | Purpose |
|---|---|
| `/login` | Email/password sign-in and Google OAuth |
| `/register` | Create a new account (full name + email + password) |
| `/forgot-password` | Request a password-reset email |
| `/reset-password` | Set a new password from the email link |

Authenticated pages (`/` and `/dashboard`) live in the `app/(app)/` route group and share
a header that shows the signed-in user's name and a Sign out button.

### Required Supabase dashboard setup

The app runs on the **Property Ledger** Supabase project (`falgykkspbtrwdcchayi`). Three
one-time dashboard tasks must be completed before the full feature set works:

1. **Expose the `sat` schema** — Settings → API → Exposed Schemas → add `sat` alongside
   `public`. Required for the app to read `sat.profiles` through PostgREST. Without this,
   every authenticated page fails when `getOrCreateProfile` runs.

2. **Google OAuth provider** — create a Google Cloud OAuth 2.0 Client ID (Web application;
   authorized redirect URI: `https://falgykkspbtrwdcchayi.supabase.co/auth/v1/callback`),
   then Authentication → Sign In / Providers → Google → enable and paste the client ID
   and secret. Only needed for the "Continue with Google" button.

3. **Email confirmation OFF + URL config** — Authentication → Providers → Email: confirm
   "Confirm email" is OFF (sign-up creates a session immediately). Authentication → URL
   Configuration: Site URL `http://localhost:3000`; Redirect URLs allow-list includes
   `http://localhost:3000/**`.

Email/password auth works once item 3 is done. Google OAuth works once item 2 is done.
Profile reads (and thus every authenticated page) work once item 1 is done.

### Environment variables

`.env.local` carries the Supabase variables from the Foundation sub-project — no new
variables are required by the Auth sub-project:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Run it locally

    pnpm install
    pnpm dev

Then open http://localhost:3000

## Deploy to Vercel

You have two easy options. Option A needs no command line.

### Option A - GitHub + Vercel (recommended)
1. Create a new repository on https://github.com and upload these files
   (everything here EXCEPT the node_modules folder).
2. Go to https://vercel.com, sign in with GitHub, and click Add New -> Project.
3. Import the repository. Vercel auto-detects Next.js -- leave all settings at defaults.
4. Click Deploy. In about a minute you get a live URL like https://your-project.vercel.app

### Option B - Vercel CLI (one command)
With Node.js installed on your computer, from inside this folder run:

    npx vercel

Follow the prompts (it opens a browser to log in the first time). Run "npx vercel --prod"
to push the production deployment.

## Project structure
- app/(app)/page.tsx                 home route (authenticated), renders the SAT practice test
- app/(app)/dashboard/page.tsx       dashboard showing the signed-in user; test history placeholder
- app/(auth)/login/page.tsx          sign-in form (email/password + Google)
- app/(auth)/register/page.tsx       account creation form
- app/(auth)/forgot-password/page.tsx  password-reset request form
- app/(auth)/reset-password/page.tsx   new-password form (after email link)
- app/auth/callback/route.ts         OAuth / email-link code exchange handler
- middleware.ts                      session refresh + route gating
- app/components/AppHeader.tsx       authenticated header (title, dashboard link, user name, sign out)
- app/components/SatPractice.tsx     thin FSM router (Start | Test | Results)
- app/components/{StartScreen,TestScreen,ResultsScreen,...}.tsx   screens + sub-components
- app/hooks/useTestSession.ts        all gameplay state + timer
- app/lib/auth/schemas.ts            zod schemas for the four auth forms
- app/lib/auth/actions.ts            signOut server action
- app/lib/auth/profile.ts            getOrCreateProfile server helper
- app/lib/test.ts                    pure logic (buildTest, computeResults, fmtTime)
- app/lib/questions.ts               typed seed question bank (33 entries: 16 RW + 17 Math)
- supabase/migrations/20260521010000_sat_profiles.sql  sat.profiles table + RLS + grants

## Adding questions
Open `app/lib/questions.ts` and add objects to the `BANK` array. Each question looks like:

```ts
{
  id: 'seed-math-018',            // stable id; see Foundation spec for format
  section: 'math',                // 'rw' or 'math'
  skill: 'Linear Equations',
  prompt: '…',
  choices: ['…', '…', '…', '…'],
  answerIndex: 1,                 // index of the correct choice (was `answer` pre-Foundation)
  explanation: '…',               // may contain inline HTML (<b>, <i>)
  source: 'seed',
}
```

Reading & Writing questions may also include a `passage` field. The app shuffles both the
question order and the answer choices on every test.

After the AI sub-project lands, the question bank moves to Supabase; this file becomes the seed source only.
