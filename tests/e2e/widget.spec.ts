import { expect, test } from '@playwright/test';

test('widget landing shows human escalation', async ({ page }) => {
  await page.goto('/widget');
  await expect(page.getByRole('button', { name: 'Talk to a human', exact: true })).toBeVisible();
});

test('restores focus after closing its nested reference dialog without force clicks', async ({ page }) => {
  await page.route('**/api/sessions/inspect', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, exists: false }) });
  });
  await page.route('**/api/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionId: 'focus-session', persisted: true }) });
  });
  await page.goto('/preview');

  await page.getByTestId('consent-button').click();
  await page.getByRole('button', { name: /start with balance assist/i }).click();
  const attachment = page.getByRole('button', { name: 'Attach references' });
  await attachment.focus();
  await attachment.press('Enter');

  await expect(page.getByRole('dialog', { name: 'Add private references' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add private references' })).toBeHidden();
  await expect(attachment).toBeFocused();
});
