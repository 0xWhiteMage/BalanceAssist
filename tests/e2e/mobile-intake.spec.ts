import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

async function enterAiIntake(page: Page) {
  await page.getByRole('button', { name: 'Build a brief with AI' }).click();
  await page.getByRole('button', { name: 'Continue with AI' }).click();

  const input = page.getByPlaceholder(/Type your message|Message the team/i);
  await expect(input).toBeVisible();
  await expect(page.getByText(/What can I help you with today\?/i)).toBeVisible();

  return input;
}

test.describe('mobile intake', () => {
  test('gives the producer-requested human upload a 44px keyboard target', async ({ page }) => {
    let uploadMode: string | null = null;
    page.on('dialog', (dialog) => dialog.accept());
    await page.route('**/api/sessions/inspect', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, exists: false })
    }));
    await page.route('**/api/sessions', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: 'mobile-human-upload-session', persisted: true })
    }));
    await page.route('**/api/projects/mobile-human-upload-session/consent', async (route) => {
      const body = route.request().postDataJSON() as { scope?: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          consent: body.scope === 'producer_transfer'
            ? { producerTransfer: true }
            : { humanContact: true }
        })
      });
    });
    await page.route('**/api/telegram/messages**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        outgoingStatus: 'delivered',
        messages: [{ id: 1, sender: 'team', text: 'Please upload the treatment.', createdAt: '2026-07-17T10:00:00.000Z' }],
        fileRequestOpen: true,
        fileRequestNote: 'Please upload the treatment.',
        scheduleRequestOpen: false
      })
    }));
    await page.route('**/api/telegram/upload', async (route) => {
      uploadMode = route.request().headers()['x-upload-mode'] ?? null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.goto('/preview');
    await page.getByRole('button', { name: 'Talk to the team without AI', exact: true }).click();

    const upload = page.getByRole('button', { name: 'Upload requested files' });
    await expect(upload).toBeVisible({ timeout: 5_000 });
    const bounds = await upload.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);

    await upload.focus();
    await expect(upload).toBeFocused();
    const chooserPromise = page.waitForEvent('filechooser');
    await upload.press('Enter');
    const chooser = await chooserPromise;
    await chooser.setFiles(path.join(__dirname, 'fixtures', 'private-upload.txt'));
    await expect.poll(() => uploadMode).toBe('human');
  });

  test('keeps the narrow widget inside the viewport with 44px actions', async ({ page }) => {
    await page.route('**/api/sessions/inspect', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, exists: false }) });
    });
    await page.route('**/api/sessions', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionId: 'narrow-layout-session', persisted: true }) });
    });
    await page.goto('/preview');
    await page.getByRole('button', { name: 'Build a brief with AI' }).click();
    await page.getByRole('button', { name: 'Continue with AI' }).click();

    const attachment = page.getByRole('button', { name: 'Attach references' });
    await expect(attachment).toBeVisible();
    const layout = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Balance Assist"]')!;
      const action = document.querySelector<HTMLElement>('button[aria-label="Attach references"]')!;
      const bounds = dialog.getBoundingClientRect();
      const actionBounds = action.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        dialogLeft: bounds.left,
        dialogRight: bounds.right,
        actionWidth: actionBounds.width,
        actionHeight: actionBounds.height
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.actionWidth).toBeGreaterThanOrEqual(44);
    expect(layout.actionHeight).toBeGreaterThanOrEqual(44);
  });

  test('uses chat/brief tabs on mobile after project intent is detected', async ({ page }) => {
    await page.route('**/api/sessions/inspect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, exists: false })
      });
    });

    await page.route('**/api/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 'mobile-session-id',
          persisted: true
        })
      });
    });

    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Your brief is ready. Review it in the Brief tab.',
          draftUpdates: {
            service: 'production',
            projectType: 'Video',
            projectScope: '30s animation for social media',
            timelineBand: '1-2-months',
            budgetBand: '20k-50k',
            contactName: 'Jayden',
            contactCompany: 'Acme',
            contactEmail: 'jayden@example.com'
          },
          briefReady: true,
          reviewPrompt: 'Your brief is ready. Review it in the Brief tab.',
          missingFields: []
        })
      });
    });

    await page.goto('/preview');

    const input = await enterAiIntake(page);
    await input.fill('30s animation for social media');
    await input.press('Enter');

    await expect(page.getByText(/Your brief is ready/i)).toBeVisible({ timeout: 5000 });

    const tablist = page.getByRole('tablist', { name: /widget sections/i });
    await expect(tablist).toBeVisible();

    const briefTab = page.getByRole('tab', { name: /brief/i });
    await briefTab.click();
    await expect(briefTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('review-rail')).toBeVisible();
    await expect(page.getByTestId('review-panel')).toHaveAttribute('data-mode', 'summary');

    const chatTab = page.getByRole('tab', { name: /chat/i });
    await chatTab.click();
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeVisible();

    await chatTab.focus();
    await chatTab.press('ArrowRight');
    await expect(briefTab).toBeFocused();
    await expect(briefTab).toHaveAttribute('aria-selected', 'true');
  });
});
