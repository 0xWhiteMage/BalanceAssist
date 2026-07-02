import { expect, test } from '@playwright/test';

test('widget landing shows human escalation', async ({ page }) => {
  await page.goto('/widget');
  await expect(page.getByRole('button', { name: 'Talk to a human', exact: true })).toBeVisible();
});
