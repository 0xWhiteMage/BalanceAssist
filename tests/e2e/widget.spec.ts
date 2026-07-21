import { expect, test } from '@playwright/test';
import path from 'node:path';

test('uses a compact rounded AI shell and accessible icon launcher', async ({ page }) => {
  await page.goto('/preview');

  const dialog = page.getByRole('dialog', { name: 'Balance Assist' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('AI brief assistant', { exact: true })).toBeVisible();

  const shell = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      position: style.position,
      borderRadius: Number.parseFloat(style.borderRadius)
    };
  });
  const viewport = page.viewportSize()!;
  if (viewport.width <= 639) {
    expect(shell).toMatchObject({ left: 0, top: 0, right: viewport.width, bottom: viewport.height, position: 'fixed', borderRadius: 0 });
  } else {
    expect(shell.left).toBeGreaterThan(0);
    expect(shell.top).toBeGreaterThan(0);
    expect(shell.right).toBeLessThanOrEqual(viewport.width);
    expect(shell.bottom).toBeLessThanOrEqual(viewport.height);
    expect(shell.borderRadius).toBe(10);
  }

  await page.getByRole('button', { name: 'Close Balance Assist' }).click();
  const launcher = page.getByRole('button', { name: 'Open Balance Assist' });
  await expect(launcher).toBeVisible();
  const launcherBounds = await launcher.boundingBox();
  expect(launcherBounds).not.toBeNull();
  expect(launcherBounds!.width).toBeGreaterThanOrEqual(56);
  expect(launcherBounds!.height).toBeGreaterThanOrEqual(56);
});

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

  await expect(page.locator('#balance-assist-dialog-title')).toHaveText('Message the team');
  await expect(page.getByText('Direct to Balance, no AI', { exact: true })).toBeVisible();
  await expect(page.getByText('AI brief assistant', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('Write a message to the Balance team...')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
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

  const notice = page.getByText('Direct messaging is temporarily unavailable. You can still email the team or book a call below.');
  const email = page.getByRole('link', { name: 'Email us', exact: true });
  const booking = page.getByRole('link', { name: 'Book a call', exact: true });
  await expect(notice).toBeVisible();
  await expect(email).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
  await expect(booking).toHaveAttribute('href', 'https://calendly.com/balance/test');
  await expect(page.getByPlaceholder(/write a message to the balance team|type a message/i)).toHaveCount(0);
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

test('equal entry actions have mobile bounds, visible keyboard focus, and keyboard activation', async ({ page }) => {
  await page.route('**/api/sessions/inspect', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, exists: false })
  }));
  await page.route('**/api/sessions', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ sessionId: 'entry-action-session', persisted: true })
  }));
  await page.route('**/api/projects/entry-action-session/consent', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, consent: { humanContact: true, producerTransfer: false } })
  }));
  await page.goto('/preview');

  const initialNames = ['Build a brief with AI', 'Talk to the team without AI', 'Leave'];
  const actions = page.locator('[data-testid="data-use-notice"] .balance-entry-action');
  const panelBackgrounds = ['#101010', '#1d1d1d'];

  function contrastRatio(foreground: string, background: string) {
    function channels(color: string) {
      if (color.startsWith('#')) {
        return color.match(/[a-f\d]{2}/gi)?.map((value) => Number.parseInt(value, 16)) ?? [];
      }
      return color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    }

    function luminance(color: string) {
      const [red, green, blue] = channels(color).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }

    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  }

  async function expectActionOrderSizeAndFocus(names: string[]) {
    expect(await actions.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim()))).toEqual(names);

    for (const name of names) {
      const action = page.getByRole('button', { name, exact: true });
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);

      await action.focus();
      await expect(action).toBeFocused();
      const focusStyle = await action.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
          outlineOffset: Number.parseFloat(style.outlineOffset),
          outlineColor: style.outlineColor
        };
      });
      expect(focusStyle.outlineStyle).not.toBe('none');
      expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(focusStyle.outlineOffset).toBeGreaterThanOrEqual(2);
      expect(focusStyle.outlineColor).toBe('rgb(219, 181, 128)');
      for (const background of panelBackgrounds) {
        expect(contrastRatio(focusStyle.outlineColor, background)).toBeGreaterThanOrEqual(3);
      }
    }
  }

  async function reloadEntry() {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Build a brief with AI', exact: true })).toBeVisible();
  }

  await expectActionOrderSizeAndFocus(initialNames);
  await page.getByRole('button', { name: 'Build a brief with AI', exact: true }).press('Space');

  await expect(page.getByRole('button', { name: 'Attach references' })).toBeVisible();

  await reloadEntry();
  await page.getByRole('button', { name: 'Talk to the team without AI', exact: true }).press('Enter');
  await expect(page.getByPlaceholder('Write a message to the Balance team...')).toBeVisible();

  await reloadEntry();
  await page.getByRole('button', { name: 'Talk to the team without AI', exact: true }).press('Space');
  await expect(page.getByPlaceholder('Write a message to the Balance team...')).toBeVisible();

  await reloadEntry();
  await page.getByRole('button', { name: 'Leave', exact: true }).press('Space');
  await expect(page.getByRole('dialog', { name: 'Balance Assist' })).toHaveCount(0);

  await reloadEntry();
  await page.getByRole('button', { name: 'Leave', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Balance Assist' })).toHaveCount(0);
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
  const attachment = page.getByRole('button', { name: 'Attach references' });
  await attachment.focus();
  await attachment.press('Enter');

  await expect(page.getByRole('dialog', { name: 'Add References & Files' })).toBeVisible();
  await attachment.focus();
  await expect(attachment).not.toBeFocused();
  await expect(attachment.click({ timeout: 500 })).rejects.toThrow(/intercepts pointer events/);
  await expect(page.getByRole('dialog', { name: 'Add References & Files' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add References & Files' })).toBeHidden();
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ analyses: [{ extractedText: '', extractionStatus: 'no_text' }] })
    });
  });
  await page.goto('/preview');

  await page.getByRole('button', { name: 'Build a brief with AI' }).click();
  const attachment = page.getByRole('button', { name: 'Attach references' });
  await attachment.focus();
  await attachment.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add References & Files' })).toBeVisible();

  const privateUpload = page.getByRole('button', { name: /store file privately/i });
  await expect(privateUpload).toBeEnabled();
  await privateUpload.focus();
  const chooserPromise = page.waitForEvent('filechooser');
  await privateUpload.press('Enter');
  const chooser = await chooserPromise;
  await chooser.setFiles(path.join(__dirname, 'fixtures', 'private-upload.txt'));

  await expect(page.getByText(/Stored privately; no readable text layer was found/i)).toBeVisible();
});
