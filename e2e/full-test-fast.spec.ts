import { test, expect } from '@playwright/test';
import {
  startTest,
  answerCurrent,
  waitForQuestion,
  openCheckYourWork,
  submitFromCheck,
} from './support/flows';

// Spec 2 (design spec §D.2): a full test WITHOUT waiting on any clock —
//   answer a couple in R&W Module 1 → Review & submit → Module 2 appears →
//   submit → BreakScreen visible → Resume early → Math Module 1/2 → results.
// Asserts the adaptive Module-1→Module-2 transition and the break flow
// end-to-end. Module submission is button-driven, so no clock waits are needed.

// Submit the currently-displayed module: answer two questions, then drive the
// Check-Your-Work review to submission. Tolerant of pool variance.
async function answerTwoAndSubmitModule(page: import('@playwright/test').Page) {
  await waitForQuestion(page);
  await answerCurrent(page);
  // Advance and answer a second question (module always has > 2 questions).
  await page.getByRole('button', { name: 'Next ›' }).click();
  await waitForQuestion(page);
  await answerCurrent(page);
  await openCheckYourWork(page);
  await submitFromCheck(page);
}

test('full test: adaptive module transition, mandatory break, resume early, results', async ({
  page,
}) => {
  await startTest(page, 'full');

  // R&W Module 1 → submit ("Continue to Module 2"). The module chip is
  // full-test only; it reads "Module 1 of 1" until Module 2 is appended lazily.
  await expect(page.getByText(/Module 1 of/)).toBeVisible();
  await answerTwoAndSubmitModule(page);

  // The adaptive Module 2 is drawn lazily after Module-1 submit; it can take a
  // moment (RPC). Assert the transition to Module 2 landed.
  await expect(page.getByText(/Module 2 of 2/)).toBeVisible({ timeout: 60_000 });
  await answerTwoAndSubmitModule(page);

  // After the LAST R&W module submits, the mandatory 10-minute break appears.
  await expect(
    page.getByRole('heading', { name: /Take a 10-minute break/ }),
  ).toBeVisible({ timeout: 60_000 });

  // Resume early → Math section begins.
  await page.getByRole('button', { name: 'Resume early' }).click();

  // Math Module 1 → Module 2 → submit test.
  await expect(page.getByText(/Module 1 of/)).toBeVisible({ timeout: 60_000 });
  await answerTwoAndSubmitModule(page);
  await expect(page.getByText(/Module 2 of 2/)).toBeVisible({ timeout: 60_000 });
  await answerTwoAndSubmitModule(page);

  // Results.
  await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Estimated score/)).toBeVisible();
});
