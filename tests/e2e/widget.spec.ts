import { expect, test } from '@playwright/test';
import path from 'node:path';

test('widget landing shows human escalation', async ({ page }) => {
  await page.goto('/widget');
  await expect(page.getByRole('button', { name: 'Talk to a human', exact: true })).toBeVisible();
});

test('direct human contact keeps a usable pending request input without claiming a team connection', async ({ page }) => {
  await page.route('**/api/sessions/inspect', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) }));
  await page.route('**/api/sessions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionId: 'human-request-session', persisted: true }) }));
  await page.route('**/api/projects/human-request-session/consent', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, consent: { humanContact: true, producerTransfer: false } }) }));
  await page.goto('/preview');

  await page.getByRole('button', { name: 'Talk to the team without AI', exact: true }).click();

  await expect(page.getByPlaceholder('Message the team request...')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Team contact requested');
  await expect(page.getByText('Team connected', { exact: true })).toHaveCount(0);
});

test('human recovery persists on mobile when session creation fails', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/sessions/inspect', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, exists: false })
  }));
  await page.route('**/api/sessions', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'session_unavailable' })
  }));
  await page.goto('/preview');

  await page.getByRole('button', { name: 'Talk to the team without AI', exact: true }).click();

  const notice = page.getByText('The private relay could not start. You can still contact the team directly.');
  const email = page.getByRole('link', { name: 'Email the team', exact: true });
  const booking = page.getByRole('link', { name: 'Book a call', exact: true });
  await expect(notice).toBeVisible();
  await expect(email).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
  await expect(booking).toHaveAttribute('href', 'https://calendly.com/balance/test');
  await expect(page.getByPlaceholder(/message the team request|type a message/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Build a brief with AI' })).toHaveCount(0);

  await email.focus();
  await expect(email).toBeFocused();
  await email.evaluate((link) => link.addEventListener('click', (event) => event.preventDefault(), { once: true }));
  await email.click();
  await booking.evaluate((link) => link.addEventListener('click', (event) => event.preventDefault(), { once: true }));
  await booking.click();
  await page.waitForTimeout(1_000);

  await expect(notice).toBeVisible();
  await expect(email).toBeVisible();
  await expect(booking).toBeVisible();
  expect(requests.filter((pathname) => pathname === '/api/sessions')).toHaveLength(1);
  expect(requests.some((pathname) => ['/api/chat', '/api/telegram/relay', '/api/telegram/messages'].includes(pathname))).toBe(false);
});

test('restores focus after closing its nested reference dialog without force clicks', async ({ page }) => {
  await page.route('**/api/sessions/inspect', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, exists: false }) });
  });
  await page.route('**/api/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionId: 'focus-session', persisted: true }) });
  });
  await page.goto('/preview');

  await page.getByRole('button', { name: 'Build a brief with AI' }).click();
  await page.getByRole('button', { name: 'Continue with AI' }).click();
  const attachment = page.getByRole('button', { name: 'Attach references' });
  await attachment.focus();
  await attachment.press('Enter');

  await expect(page.getByRole('dialog', { name: 'Add private references' })).toBeVisible();
  await attachment.focus();
  await expect(attachment).not.toBeFocused();
  await expect(attachment.click({ timeout: 500 })).rejects.toThrow(/intercepts pointer events/);
  await expect(page.getByRole('dialog', { name: 'Add private references' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add private references' })).toBeHidden();
  await expect(attachment).toBeFocused();
});

test('stores an available private upload through the keyboard path', async ({ page }) => {
  await page.route('**/api/sessions/inspect', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, exists: false }) });
  });
  await page.route('**/api/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionId: 'private-upload-session', persisted: true }) });
  });
  await page.route('**/api/projects/private-upload-session/consent', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/telegram/upload', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analyses: [] }) });
  });
  await page.goto('/preview');

  await page.getByRole('button', { name: 'Build a brief with AI' }).click();
  await page.getByRole('button', { name: 'Continue with AI' }).click();
  const attachment = page.getByRole('button', { name: 'Attach references' });
  await attachment.focus();
  await attachment.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add private references' })).toBeVisible();

  await page.getByLabel(/Balance Assist may analyse these files/i).check();
  const privateUpload = page.getByRole('button', { name: /store file privately/i });
  await expect(privateUpload).toBeEnabled();
  await privateUpload.focus();
  const chooserPromise = page.waitForEvent('filechooser');
  await privateUpload.press('Enter');
  const chooser = await chooserPromise;
  await chooser.setFiles(path.join(__dirname, 'fixtures', 'private-upload.txt'));

  await expect(page.getByText('Stored privately')).toBeVisible();
});
