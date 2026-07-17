import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function stubSessionBootstrap(page: import('@playwright/test').Page) {
  await page.route('**/api/sessions/inspect', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, exists: false })
  }));
  await page.route('**/api/sessions', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ sessionId: 'accessibility-session', persisted: true })
  }));
}

test('passes axe with a named transcript, visible composer label, and modal-only controls', async ({ page }) => {
  await stubSessionBootstrap(page);
  await page.goto('/preview');

  const dialog = page.getByRole('dialog', { name: 'Balance Assist' });
  await expect(dialog).toBeVisible();
  const initialResults = await new AxeBuilder({ page })
    .include('.balance-widget-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(initialResults.violations).toEqual([]);

  await page.getByRole('button', { name: 'Build a brief with AI' }).click();
  await page.getByRole('button', { name: 'Continue with AI' }).click();
  await expect(page.getByRole('log', { name: 'Conversation transcript' })).toBeVisible();
  const composerInput = page.getByRole('textbox', { name: 'Message Balance Assist' });
  await expect(composerInput).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  const composerBounds = await composerInput.boundingBox();
  expect(composerBounds).not.toBeNull();
  expect(composerBounds!.width).toBeGreaterThanOrEqual(140);

  const activeControls = await dialog.locator('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), iframe').evaluateAll((controls) =>
    controls.filter((control) => {
      const style = getComputedStyle(control);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).map((control) => ({
      name: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.tagName,
      inert: Boolean(control.closest('[inert]'))
    }))
  );
  expect(activeControls.length).toBeGreaterThan(0);
  expect(activeControls.filter((control) => control.inert)).toEqual([]);

  const activeResults = await new AxeBuilder({ page })
    .include('.balance-widget-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(activeResults.violations).toEqual([]);
});

test('restores launcher focus and reflows at zoom-equivalent, landscape, and keyboard heights', async ({ page }) => {
  await page.goto('/preview');
  await page.getByRole('button', { name: 'Close Balance Assist' }).click();

  const launcher = page.getByRole('button', { name: 'Open Balance Assist' });
  await launcher.focus();
  await launcher.press('Enter');
  await page.keyboard.press('Escape');
  await expect(launcher).toBeFocused();

  for (const viewport of [
    { width: 640, height: 320 },
    { width: 320, height: 640 },
    { width: 320, height: 420 }
  ]) {
    await page.setViewportSize(viewport);
    await launcher.click();
    const dialog = page.getByRole('dialog', { name: 'Balance Assist' });
    await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    const overflow = await dialog.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    await page.getByRole('button', { name: 'Close Balance Assist' }).click();
  }
});

test('includes the Calendly iframe in keyboard order with an accessible return action', async ({ page }) => {
  await stubSessionBootstrap(page);
  await page.route('**/api/projects/accessibility-session/consent', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, consent: { humanContact: true, producerTransfer: false } })
  }));
  await page.route('**/api/telegram/messages**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      outgoingStatus: 'delivered',
      messages: [{ id: 1, sender: 'team', text: 'Please choose a time.', createdAt: '2026-07-18T10:00:00.000Z' }],
      fileRequestOpen: false,
      fileRequestNote: null,
      scheduleRequestOpen: true
    })
  }));

  await page.goto('/preview');
  await page.getByRole('button', { name: 'Talk to the team without AI', exact: true }).click();

  const calendar = page.getByRole('dialog', { name: 'Book a Discovery Call' });
  await expect(calendar).toBeVisible({ timeout: 10_000 });
  const back = calendar.getByRole('button', { name: 'Back to chat' });
  await expect(back).toBeVisible();
  const frame = calendar.locator('iframe').first();
  await expect(frame).toBeVisible({ timeout: 10_000 });

  await back.focus();
  await back.press('Tab');
  await expect.poll(() => frame.evaluate((element) => document.activeElement === element)).toBe(true);

  await back.focus();
  await back.press('Enter');
  await expect(calendar).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Message the Balance team' })).toBeVisible();
});
