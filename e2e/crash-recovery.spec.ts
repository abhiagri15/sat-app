import { test, expect } from '@playwright/test';
import { startTest, answerCurrent, waitForQuestion } from './support/flows';

// Spec 3 (design spec §D.3): mid-test crash recovery via the localStorage
// snapshot. Start a short test, answer one, page.reload(), assert the
// "Resume your test?" card, Resume, assert the answered state survived; then the
// Discard path on a second run.

test('crash recovery: reload shows resume card, Resume restores the answered state', async ({
  page,
}) => {
  await startTest(page, 'short');

  // Answer Q1 (mcq or spr) so there's persisted answered state to recover.
  const kind = await answerCurrent(page);

  // The throttled snapshot writer fires within ~2s; give it a beat, then a
  // visibility flush is triggered by the reload/navigation itself.
  await page.waitForTimeout(2500);

  await page.reload();

  // The Start screen now offers to resume the in-progress test.
  await expect(page.getByText('Resume your test?')).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'Resume test' }).click();

  // Back in the runner on Q1; the answered state survived.
  await waitForQuestion(page);
  if (kind === 'spr') {
    await expect(page.locator('input[inputmode="numeric"]')).toHaveValue('5');
  } else {
    // The navigator marks question 1 as answered after restore.
    await expect(
      page.getByRole('button', { name: /Question 1,.*answered/ }),
    ).toBeVisible();
  }
});

test('crash recovery: Discard clears the snapshot and returns to a fresh start', async ({
  page,
}) => {
  await startTest(page, 'short');
  await answerCurrent(page);
  await page.waitForTimeout(2500);
  await page.reload();

  await expect(page.getByText('Resume your test?')).toBeVisible({
    timeout: 30_000,
  });

  // Discard the in-progress test.
  await page.getByRole('button', { name: 'Discard' }).click();

  // The resume card is gone and the Start screen is clean (Start Test available).
  await expect(page.getByText('Resume your test?')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Start Test' }),
  ).toBeVisible();

  // A reload does NOT bring the card back — the snapshot was cleared.
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'SAT Practice Test' }),
  ).toBeVisible();
  await expect(page.getByText('Resume your test?')).toBeHidden();
});
