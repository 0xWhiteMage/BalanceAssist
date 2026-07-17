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
    const canonicalDraft = {
      service: 'production',
      projectType: 'Video',
      projectScope: '30s animation for social media',
      timelineBand: '1-2 months',
      budgetBand: '$20k-$50k',
      contactName: 'Jayden',
      contactCompany: 'Acme',
      contactEmail: 'jayden@example.com'
    };
    const producerTransferRequests: unknown[] = [];
    let canonicalRefreshes = 0;
    let referenceAdded = false;
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

    await page.route('**/api/projects/mobile-session-id/draft', async (route) => {
      if (route.request().method() === 'GET') {
        canonicalRefreshes += 1;
        const updatedAt = '2026-07-17T10:00:00.000Z';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'mobile-session-id',
            draft: Object.fromEntries(Object.entries(canonicalDraft).map(([field, value]) => [
              field,
              { value, provenance: field === 'projectScope' ? 'confirmed' : 'user-stated', updatedAt }
            ])),
            draftVersion: 2,
            fieldCount: Object.keys(canonicalDraft).length,
            referenceLinks: referenceAdded
              ? [{ id: 'mobile-reference-1', sessionId: 'mobile-session-id', kind: 'vimeo', url: 'https://vimeo.com/123' }]
              : [],
            canonicalReferenceSetHash: referenceAdded ? 'with-reference' : 'without-reference'
          })
        });
        return;
      }
      const body = route.request().postDataJSON() as { fields?: Array<{ field: string; value: string }> };
      for (const field of body.fields ?? []) {
        canonicalDraft[field.field as keyof typeof canonicalDraft] = field.value;
      }
      const updatedAt = '2026-07-17T10:00:00.000Z';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 'mobile-session-id',
          draft: Object.fromEntries(Object.entries(canonicalDraft).map(([field, value]) => [
            field,
            { value, provenance: field === 'projectScope' ? 'confirmed' : 'user-stated', updatedAt }
          ])),
          draftVersion: 2,
          fieldCount: Object.keys(canonicalDraft).length
        })
      });
    });

    await page.route('**/api/attachments/link', async (route) => {
      const body = route.request().postDataJSON() as { url: string; kind: string; sessionId: string };
      referenceAdded = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, persisted: true, link: { id: 'mobile-reference-1', ...body } })
      });
    });

    await page.route('**/api/attachments/link/mobile-reference-1', async (route) => {
      referenceAdded = false;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, deleted: true }) });
    });

    await page.route('**/api/projects/mobile-session-id/consent', async (route) => {
      producerTransferRequests.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'draft_persisted',
          message: 'Your core brief is ready. Review it in the Brief tab.',
          draftUpdates: canonicalDraft,
          canonicalDraft,
          canonicalProvenance: Object.fromEntries(Object.keys(canonicalDraft).map((field) => [field, 'user-stated'])),
          draftVersion: 1,
          currentStage: 'references-contact',
          stageRecaps: [],
          briefReady: true,
          reviewPrompt: 'Your core brief is ready. Review it in the Brief tab.',
          missingFields: []
        })
      });
    });

    await page.goto('/preview');

    const input = await enterAiIntake(page);
    await input.fill('30s animation for social media');
    await input.press('Enter');

    await expect(page.getByText(/Your core brief is ready/i)).toBeVisible({ timeout: 5000 });

    const readyStatus = page.getByRole('status', { name: 'Brief ready' });
    await expect(readyStatus).toHaveText('Your core brief is ready. Review it in the Brief tab.');
    await expect(page.getByRole('log')).not.toContainText('Your core brief is ready');

    const tablist = page.getByRole('tablist', { name: /widget sections/i });
    await expect(tablist).toBeVisible();

    const briefTab = page.getByRole('tab', { name: /brief/i });
    const chatPanel = page.locator('#widget-chat-panel');
    const briefPanel = page.locator('#widget-brief-panel');
    await expect(chatPanel).toBeVisible();
    await expect(briefPanel).toBeHidden();
    await expect(briefPanel).toHaveAttribute('inert', '');
    await briefTab.click();
    await expect(briefTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('review-rail')).toBeVisible();
    await expect(page.getByTestId('review-panel')).toHaveAttribute('data-mode', 'summary');

    await page.getByRole('button', { name: 'Edit original wording' }).click();
    const scopeEditor = page.getByRole('textbox', { name: 'Original wording' });
    await scopeEditor.fill('Updated mobile launch film');
    const chatTab = page.getByRole('tab', { name: /chat/i });
    await chatTab.click();
    await expect(chatPanel).toBeVisible();
    await expect(briefPanel).toBeHidden();
    await expect(briefPanel).toHaveAttribute('inert', '');
    await briefTab.click();
    await expect(scopeEditor).toHaveValue('Updated mobile launch film');
    await page.getByRole('button', { name: 'Save original wording' }).click();
    await expect(page.getByText('Updated mobile launch film')).toBeVisible();

    const referenceInput = page.getByRole('textbox', { name: 'Reference URL' });
    await referenceInput.fill('https://vimeo.com/123');
    await page.getByRole('button', { name: 'Add reference link' }).click();
    const referenceLink = page.getByRole('link', { name: 'https://vimeo.com/123' });
    await expect(referenceLink).toBeVisible();
    await page.getByRole('button', { name: 'Remove https://vimeo.com/123' }).click();
    await expect(referenceLink).toHaveCount(0);
    expect(canonicalRefreshes).toBe(2);
    expect(producerTransferRequests).toEqual([]);

    await chatTab.click();
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeVisible();

    await chatTab.focus();
    await chatTab.press('ArrowRight');
    await expect(briefTab).toBeFocused();
    await expect(briefTab).toHaveAttribute('aria-selected', 'true');

    const human = page.getByRole('button', { name: 'Talk to a human' });
    await expect(human).toBeVisible();
    await expect(human).toHaveClass(/balance-widget-action/);
    const humanBounds = await human.boundingBox();
    expect(humanBounds).not.toBeNull();
    expect(humanBounds!.width).toBeGreaterThanOrEqual(44);
    expect(humanBounds!.height).toBeGreaterThanOrEqual(44);
  });
});
