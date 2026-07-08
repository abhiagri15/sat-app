import { test, expect } from '@playwright/test';
import {
  startTest,
  answerCurrent,
  waitForQuestion,
  openCheckYourWork,
  submitFromCheck,
} from './support/flows';

// Spec 1 (design spec §D.1): a full short-test run —
//   answer 2 (one via the eliminator interaction), mark one for review,
//   navigator badges reflect answered/marked, Review & submit → Check Your Work
//   (marked/unanswered legend), submit both sections → results shows
//   "Estimated score" + save status "Saved", dashboard lists the attempt.
test('short test: answer, eliminate, mark, check your work, submit, results, dashboard', async ({
  page,
}) => {
  await startTest(page, 'short');

  // --- Question 1: use the eliminator, then answer. -----------------------
  // Turn the answer eliminator on (the "Cross out" toolbar toggle).
  await page.getByRole('button', { name: /Cross out/ }).click();

  const isSpr = await page
    .locator('input[inputmode="numeric"]')
    .isVisible()
    .catch(() => false);
  if (isSpr) {
    // SPR has no choices to eliminate — just answer.
    await page.locator('input[inputmode="numeric"]').fill('5');
  } else {
    // Eliminate option A (the per-choice ✕ control appears with the eliminator
    // on), then select option B so the question still counts as answered.
    await page
      .getByRole('button', { name: /Eliminate option A/ })
      .click();
    // The eliminated row shows a strike-through / restore control now.
    await expect(
      page.getByRole('button', { name: /Restore option A/ }),
    ).toBeVisible();
    // Answer by clicking choice B's letter label.
    await page.locator('span', { hasText: /^B$/ }).first().click();
  }

  // --- Mark THIS question for review. --------------------------------------
  await page.getByRole('button', { name: 'Mark for Review', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Marked for review', exact: true }),
  ).toBeVisible();

  // Navigator: question 1 should now read "answered" and "marked for review".
  await expect(
    page.getByRole('button', { name: /Question 1,.*answered.*marked for review/ }),
  ).toBeVisible();

  // --- Advance to Q2 and answer it. ----------------------------------------
  await page.getByRole('button', { name: 'Next ›' }).click();
  await waitForQuestion(page);
  await answerCurrent(page);

  // Navigator: question 2 should read "answered".
  await expect(
    page.getByRole('button', { name: /Question 2,.*answered/ }),
  ).toBeVisible();

  // --- Review & submit → Check Your Work. ----------------------------------
  await openCheckYourWork(page);
  // The Check-Your-Work legend proves the marked/unanswered states render.
  await expect(page.getByText('Marked for review')).toBeVisible();
  await expect(page.getByText('Unanswered')).toBeVisible();

  // Submit R&W section, then the Math section (short test = 2 sections).
  await submitFromCheck(page);

  // Section 2: answer one and submit the whole test.
  await waitForQuestion(page);
  await answerCurrent(page);
  await openCheckYourWork(page);
  await submitFromCheck(page);

  // --- Results: "Estimated score" + save status "Saved". -------------------
  await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Estimated score/)).toBeVisible();
  // The save status settles to "Saved to your dashboard ✓".
  await expect(page.getByText(/Saved to your dashboard/)).toBeVisible({
    timeout: 30_000,
  });

  // --- Dashboard lists the attempt. ----------------------------------------
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Your dashboard' }),
  ).toBeVisible();
  await expect(page.getByText('Your test history')).toBeVisible();
  // At least one attempt card links into a saved attempt.
  await expect(
    page.locator('a[href^="/dashboard/attempts/"]').first(),
  ).toBeVisible();
});
