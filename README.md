# SAT Practice Test (Next.js)

A timed, replayable SAT-style practice test built with React (Next.js 14, App Router).
Enter a name, take timed Reading & Writing and Math sections, submit, and get an instant
score with a worked explanation for every question. "Start a New Test" reshuffles fresh,
randomized questions and answer order.

## Run it locally

    npm install
    npm run dev

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
- app/page.js          home route, renders the test component
- app/SatPractice.jsx  all test logic (start screen, timer, scoring, review)
- app/questions.js     the question bank (add or edit questions here)
- app/SatPractice.module.css / app/globals.css   styling

## Adding questions
Open app/questions.js and add objects to the BANK array. Each question looks like:

    {
      section: 'math',           // 'rw' or 'math'
      skill: 'Linear Equations',
      prompt: 'If 3x + 7 = 22, what is the value of x?',
      choices: ['3', '5', '7', '15'],
      answer: 1,                 // index of the correct choice
      explanation: 'Subtract 7: 3x = 15. Divide by 3: x = 5.',
    }

Reading & Writing questions may also include a "passage" field. The app shuffles both the
question order and the answer choices on every test.
