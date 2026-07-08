import { expect, type Page } from '@playwright/test';

// Shared UI-flow helpers for the test-runner specs. Selectors use the REAL
// labels read from the components (StartScreen, TestScreen, QuestionView,
// QuestionNavigator, CheckYourWork). Tolerant of pool variance: never asserts
// question text, and answers whatever question is presented (mcq OR spr).

// Start a fresh test from the Start screen. `length` picks the toggle first.
// Generous wait: the pool draw (RPC) can be slow.
export async function startTest(
  page: Page,
  length: 'short' | 'full',
): Promise<void> {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'SAT Practice Test' }),
  ).toBeVisible();
  // If a leftover "Resume your test?" card is showing (a prior spec crashed),
  // discard it so we get a clean start.
  const resumeCard = page.getByText('Resume your test?');
  if (await resumeCard.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Discard' }).click();
  }
  const toggle =
    length === 'short'
      ? page.getByRole('button', { name: /^Quick/ })
      : page.getByRole('button', { name: /^Full/ });
  await toggle.click();
  await page.getByRole('button', { name: 'Start Test' }).click();
  // The runner shows the TopBar; wait for a question prompt region to appear.
  await waitForQuestion(page);
}

// The QuestionView primary nav button reads "Next ›" on non-last questions and
// "Review" on the last question — an exact-name match avoids colliding with the
// "Mark for Review" toolbar button or Next.js dev-tools.
export function questionNavButton(page: Page) {
  return page
    .getByRole('button', { name: 'Next ›' })
    .or(page.getByRole('button', { name: 'Review', exact: true }));
}

// Wait until a question is on screen (the QuestionView nav button is the most
// stable runner landmark that isn't the pool-variant question text).
export async function waitForQuestion(page: Page): Promise<void> {
  await expect(questionNavButton(page)).toBeVisible({ timeout: 60_000 });
}

// Answer the CURRENTLY-displayed question. SPR-branch: if the numeric grid-in
// input is visible, type '5'; otherwise click the first mcq choice. Returns the
// kind answered (useful for a couple of assertions).
export async function answerCurrent(page: Page): Promise<'spr' | 'mcq'> {
  // SprInput renders an <input inputmode="numeric">; mcq renders choice rows.
  const sprInput = page.locator('input[inputmode="numeric"]');
  if (await sprInput.isVisible().catch(() => false)) {
    await sprInput.fill('5');
    return 'spr';
  }
  // mcq choice rows are the letter-prefixed clickable divs in QuestionView.
  // The letter label span (A/B/C/D) is a stable anchor inside each row.
  const firstChoice = page.locator('span', { hasText: /^A$/ }).first();
  await firstChoice.click();
  return 'mcq';
}

// Advance to the next question within the module (the "Next ›" button).
export async function clickNext(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next ›' }).click();
}

// Open the Check-Your-Work review page from the navigator ("Review & submit").
export async function openCheckYourWork(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review & submit' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your work' }),
  ).toBeVisible();
}

// Submit the current module from the Check-Your-Work page. The primary button
// carries the FSM label (Continue to Module 2 / Submit section / Submit test).
export async function submitFromCheck(page: Page): Promise<void> {
  const submit = page
    .getByRole('button', {
      name: /Continue to Module 2|Submit section|Submit test/,
    })
    .last();
  await submit.click();
}
