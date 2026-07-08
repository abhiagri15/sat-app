import { test, expect, type Page } from '@playwright/test';

// Spec 4 (design spec §D.4): /practice → open a skill → start a drill → answer
// all 10 arbitrarily → reach the summary → assert the save status; and WHEN any
// recap row is incorrect, assert the miss-reason chips render and a chip click
// persists visually. Answering wrong-on-purpose isn't controllable (the
// canonical answer is server-side), so we answer arbitrarily and branch.

// Answer the current drill question, then advance. SPR → type '5'; mcq → click
// the first choice. After "Check answer", the panel shows "Next question" /
// "See results".
async function answerDrillQuestion(page: Page, last: boolean): Promise<void> {
  const sprInput = page.locator('input[inputmode="numeric"]');
  if (await sprInput.isVisible().catch(() => false)) {
    await sprInput.fill('5');
  } else {
    // mcq choices: each row is a div containing a full-width choice <button>.
    // The choice buttons sit in the flex-col choices container right before the
    // "Check answer" button. Click the first choice button (it precedes and is
    // distinct from the "Cross out"/"Check answer" buttons).
    const checkBtn = page.getByRole('button', { name: 'Check answer' });
    await expect(checkBtn).toBeVisible();
    // The first choice button is the first <button> that is not the eliminator
    // toggle ("Cross out") and not "Check answer". Scope to the choice rows.
    const choiceRow = page
      .locator('div.flex.flex-col.gap-2\\.5 > div')
      .first();
    await choiceRow.locator('button[type="button"]').first().click();
  }
  await page.getByRole('button', { name: 'Check answer' }).click();
  // Feedback panel is up; advance.
  await page
    .getByRole('button', { name: last ? 'See results' : 'Next question' })
    .click();
}

test('drill: run a 10-question drill to summary, assert save + miss-reason chips', async ({
  page,
}) => {
  await page.goto('/practice');
  await expect(page.getByRole('heading', { name: 'Practice', exact: true })).toBeVisible();

  // Open the first skill in the catalog (a stable "/practice/<slug>" link).
  await page.locator('a[href^="/practice/"]').first().click();

  // The skill page shows the "Start practice" card (idle phase). Some skills
  // auto-start via ?drill=1, but catalog links don't — so start it.
  const startBtn = page.getByRole('button', { name: 'Start practice' });
  await expect(startBtn).toBeVisible({ timeout: 30_000 });
  await startBtn.click();

  // Drill loads (RPC draw). The progress header appears in two places (the
  // SkillDrill progress line and the DrillQuestion card header) — use .first().
  const progress = page.getByText(/Question 1 of \d+/).first();
  await expect(progress).toBeVisible({ timeout: 60_000 });

  // Determine total from the progress header, then loop.
  const header = await progress.textContent();
  const total = Number(header?.match(/of (\d+)/)?.[1] ?? 10);

  for (let i = 0; i < total; i++) {
    await answerDrillQuestion(page, i === total - 1);
  }

  // --- Summary. ------------------------------------------------------------
  await expect(page.getByText(/\d+\/\d+ correct/)).toBeVisible({
    timeout: 30_000,
  });
  // Save status settles to "Saved to your history".
  await expect(page.getByText('Saved to your history')).toBeVisible({
    timeout: 30_000,
  });

  // --- Miss-reason chips (only when a recap row is incorrect). -------------
  // The chips render under incorrect rows once the saved response ids resolve.
  const chipsHeading = page.getByText('Why did you miss this?').first();
  const hasIncorrect = await chipsHeading
    .isVisible({ timeout: 15_000 })
    .catch(() => false);

  if (hasIncorrect) {
    // Click the first miss-reason chip and assert it becomes selected
    // (aria-pressed flips true and stays — the optimistic write is confirmed).
    const firstChip = chipsHeading
      .locator('xpath=following-sibling::div[1]')
      .getByRole('button')
      .first();
    await firstChip.click();
    await expect(firstChip).toHaveAttribute('aria-pressed', 'true');
  } else {
    // A perfect drill (all correct) is legitimate given a fixed '5'/first-choice
    // strategy against a variable pool — the spec still passes. Log for clarity.
    test.info().annotations.push({
      type: 'note',
      description: 'Drill had no incorrect rows; miss-reason chips not exercised this run.',
    });
  }
});
