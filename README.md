# SAT Practice Test (Next.js)

A timed, replayable SAT-style practice test built with React (Next.js 15, App Router, React 19).
Enter a name, take timed Reading & Writing and Math sections, submit, and get an instant
score with a worked explanation for every question. "Start a New Test" reshuffles fresh,
randomized questions and answer order.

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
- app/page.tsx                       home route, renders the SAT practice test
- app/components/SatPractice.tsx     thin FSM router (Start | Test | Results)
- app/components/{StartScreen,TestScreen,ResultsScreen,...}.tsx   screens + sub-components
- app/hooks/useTestSession.ts        all gameplay state + timer
- app/lib/test.ts                    pure logic (buildTest, computeResults, fmtTime)
- app/lib/questions.ts               typed seed question bank (33 entries: 16 RW + 17 Math)
- app/dashboard/page.tsx             placeholder, fills in after Auth sub-project

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
