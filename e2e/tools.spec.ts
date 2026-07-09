import { test, expect, type Page } from '@playwright/test';
import { startTest } from './support/flows';

// Spec 5 (design spec §D.5): passage tools in a short test on an R&W question —
//   highlighter toggle → select passage text → a <mark> appears → click the mark
//   → note popover → save note → dotted style; line-reader toggle shows the
//   band; Escape dismisses. The Highlighter/Line-reader toggles appear ONLY when
//   the current question HAS a passage, so we navigate to a passage question
//   first. R&W is the first section of a short test.

// The passage container (QuestionView) has the blue left border + slate bg. It
// is the element the highlighter/line-reader operate on.
function passageLocator(page: Page) {
  return page.locator('div.border-l-4.border-blue-500').first();
}

// Navigate forward within the R&W module until the Highlighter toggle appears
// (i.e. the current question has a passage). Returns true if found.
async function gotoPassageQuestion(page: Page): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    const highlighter = page.getByRole('button', { name: /Highlighter/ });
    if (await highlighter.isVisible().catch(() => false)) return true;
    const next = page.getByRole('button', { name: /^Next/ });
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(300);
  }
  // Check once more after the loop's last advance.
  return await page
    .getByRole('button', { name: /Highlighter/ })
    .isVisible()
    .catch(() => false);
}

// Select the whole passage text via a triple-click-style drag (Playwright's
// selectText on the container). Returns after the browser selection is set.
async function selectPassageText(page: Page): Promise<void> {
  const passage = passageLocator(page);
  // Selecting the container's text content, then dispatching mouseup so
  // QuestionView's handlePassageMouseUp reads the selection.
  await passage.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  // The add-highlight handler runs on the passage's mouseup event.
  await passage.dispatchEvent('mouseup');
}

test('tools: highlighter mark + note popover, and line reader band with Escape', async ({
  page,
}) => {
  await startTest(page, 'short');

  const hasPassage = await gotoPassageQuestion(page);
  test.skip(
    !hasPassage,
    'No R&W passage question in this short-test draw (pool variance).',
  );

  // --- Highlighter: toggle on, select text, a <mark> appears. --------------
  await page.getByRole('button', { name: /Highlighter/ }).click();
  await expect(
    page.getByRole('button', { name: /Highlighter on/ }),
  ).toBeVisible();

  await selectPassageText(page);

  // A <mark> now wraps the highlighted run.
  const mark = passageLocator(page).locator('mark').first();
  await expect(mark).toBeVisible({ timeout: 10_000 });

  // --- Click the mark → note popover opens. --------------------------------
  await mark.click();
  const popover = page.getByRole('dialog', { name: 'Highlight note' });
  await expect(popover).toBeVisible();

  // Type a note and Save.
  await popover.locator('textarea').fill('remember this line');
  await popover.getByRole('button', { name: 'Save note' }).click();
  await expect(popover).toBeHidden();

  // --- Noted mark renders with the dotted underline style. -----------------
  // segmentText splits the note-bearing run; the noted <mark> gets
  // "decoration-dotted". Assert at least one mark carries that class.
  await expect(
    passageLocator(page).locator('mark.decoration-dotted').first(),
  ).toBeVisible();

  // --- Line reader: toggle on shows the focus band; Escape dismisses. ------
  // Turn the highlighter off first so clicks don't re-open the popover.
  await page.getByRole('button', { name: /Highlighter on/ }).click();
  await page.getByRole('button', { name: /Line reader/ }).click();
  await expect(
    page.getByRole('button', { name: /Line reader on/ }),
  ).toBeVisible();

  // The band overlay (LineReader) mounts inside the passage container. It's a
  // purely visual aria-hidden overlay, so it carries a data-testid hook.
  await expect(page.getByTestId('line-reader')).toBeVisible();

  // Escape turns the line reader off (onClose) — the overlay unmounts and the
  // toggle reverts to "Line reader".
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: /Line reader on/ }),
  ).toBeHidden();
  await expect(page.getByTestId('line-reader')).toBeHidden();
});

// Touch path (sub-project #21, spec C6): tap-to-show read-only note when the
// highlighter is OFF. Runs in a touch-enabled context. The noted mark is
// created via the MOUSE path first (allowed — Playwright cannot faithfully
// emulate a long-press touch selection; the touch behavior under test is the
// TAP-to-show, not the synthetic selection). Then, tool OFF, we `tap()` the
// noted mark and assert the read-only note popover shows, and a tap outside
// dismisses it.
test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('tools (touch): tap a noted mark shows the read-only note; tap outside dismisses', async ({
    page,
  }) => {
    await startTest(page, 'short');

    const hasPassage = await gotoPassageQuestion(page);
    test.skip(
      !hasPassage,
      'No R&W passage question in this short-test draw (pool variance).',
    );

    // Create a noted highlight via the mouse path (allowed for setup).
    await page.getByRole('button', { name: /Highlighter/ }).click();
    await expect(
      page.getByRole('button', { name: /Highlighter on/ }),
    ).toBeVisible();
    await selectPassageText(page);

    const mark = passageLocator(page).locator('mark').first();
    await expect(mark).toBeVisible({ timeout: 10_000 });
    await mark.click();
    const editPopover = page.getByRole('dialog', { name: 'Highlight note' });
    await expect(editPopover).toBeVisible();
    await editPopover.locator('textarea').fill('touch note here');
    await editPopover.getByRole('button', { name: 'Save note' }).click();
    await expect(editPopover).toBeHidden();

    // Turn the highlighter OFF — now the mark is the read-only-note tap target.
    await page.getByRole('button', { name: /Highlighter on/ }).click();
    await expect(
      page.getByRole('button', { name: /Highlighter/ }),
    ).toBeVisible();

    // Tap the noted mark → the read-only note popover shows its text.
    const notedMark = passageLocator(page)
      .locator('mark.decoration-dotted')
      .first();
    await notedMark.tap();
    const readPopover = page.getByRole('dialog', { name: 'Highlight note' });
    await expect(readPopover).toBeVisible();
    await expect(readPopover).toContainText('touch note here');

    // Tap outside → the popover dismisses. The question prompt (a non-
    // interactive heading below the passage) is a stable outside-tap target.
    await page.locator('div.text-lg.font-semibold').first().tap();
    await expect(readPopover).toBeHidden();
  });
});
