import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';

async function enterAiIntake(page: Page) {
  await page.getByRole('button', { name: 'Build a brief with AI' }).click();

  const input = page.getByPlaceholder(/Type your message|Message the team/i);
  await expect(input).toBeVisible();
  await expect(page.getByText(/What can I help you with today\?/i)).toBeVisible();

  return input;
}

async function assertMinimumTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
}

async function assertNoHorizontalOverflow(locator: Locator, label: string) {
  const measurements = await locator.evaluateAll((elements) => elements.map((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  })));
  expect(measurements.length, label).toBeGreaterThan(0);
  for (const [index, measurement] of measurements.entries()) {
    expect(measurement.scrollWidth, `${label}[${index}]`).toBeLessThanOrEqual(measurement.clientWidth);
  }
}

async function assertDirectContactRoutes(page: Page) {
  await assertMinimumTarget(page.getByRole('button', { name: 'Talk to the team without AI', exact: true }));
  await expect(page.getByRole('link', { name: 'Email the team', exact: true })).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
  await expect(page.getByRole('link', { name: 'Book a call', exact: true })).toHaveAttribute('href', 'https://calendly.com/balance/test');
}

function versionedDraft(draft: Record<string, string>, provenance: Record<string, string>) {
  const updatedAt = '2026-07-17T10:00:00.000Z';
  return Object.fromEntries(Object.entries(draft).map(([field, value]) => [
    field,
    { value, provenance: provenance[field] ?? 'user-stated', updatedAt }
  ]));
}

test.describe('mobile intake', () => {
  test('covers the staged intake copy, reflow, keyboard tabs, errors, and targets at 320px', async ({ page }) => {
    const sessionId = 'mobile-thesis-session';
    const originalWording = 'A launch film for our accessibility initiative that introduces the programme to customers across regional communities and partner organisations';
    const aiSummary = 'An uplifting and inclusive launch film that explains the accessibility programme clearly for customers, community partners, and regional teams.';
    const canonicalDraft: Record<string, string> = {};
    const provenance: Record<string, string> = {};
    const savedEdits: Array<{ field: string; value: string }> = [];
    let draftVersion = 0;
    let chatCalls = 0;
    let finalizeAttempts = 0;
    const eventPayloads: Array<{ eventName?: string; properties?: Record<string, unknown> }> = [];

    type StageFixture = {
      currentStage: 'audience' | 'planning' | 'references-contact';
      message: string;
      recap: string;
      updates: Record<string, string>;
      inferred: readonly string[];
    };
    const stages: readonly StageFixture[] = [
      {
        currentStage: 'audience',
        message: 'Who is this for?',
        recap: `So far: ${originalWording}; objective: Introduce the initiative to customers.`,
        updates: {
          projectScope: originalWording,
          scopePolished: aiSummary,
          projectObjective: 'Introduce the initiative to customers.',
          projectType: 'Film',
          service: 'production'
        },
        inferred: ['scopePolished']
      },
      {
        currentStage: 'planning',
        message: 'Timeline helps with planning and feasibility, while budget helps us suggest realistic formats and scope. What timeline are you working with?',
        recap: 'So far: audience: Not sure yet; intended outputs: Skip.',
        updates: { audience: 'Not sure yet', intendedOutputs: 'Skip' },
        inferred: []
      },
      {
        currentStage: 'references-contact',
        message: 'Would you like to add any references, or Skip?',
        recap: 'So far: timeline: Not sure yet; budget: Prefer not to share.',
        updates: { timelineBand: 'Not sure yet', budgetBand: 'Prefer not to share' },
        inferred: []
      },
      {
        currentStage: 'references-contact',
        message: 'Your core brief is ready. Review it in the Brief tab before sending it to Balance.',
        recap: 'So far: references: Skipped; contact name: Jayden; contact email: jayden@example.com.',
        updates: {
          referencesStatus: 'skipped',
          contactName: 'Jayden',
          contactCompany: 'Acme',
          contactEmail: 'jayden@example.com'
        },
        inferred: []
      }
    ];

    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/sessions/inspect', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, exists: false })
    }));
    await page.route('**/api/sessions', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId, persisted: true })
    }));
    await page.route('**/api/events', async (route) => {
      const payload = route.request().postDataJSON() as { eventName?: string; properties?: Record<string, unknown> };
      eventPayloads.push({ eventName: payload.eventName, properties: payload.properties });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, eventName: payload.eventName }) });
    });
    await page.route(`**/api/projects/${sessionId}/draft`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId,
            draft: versionedDraft(canonicalDraft, provenance),
            draftVersion,
            fieldCount: Object.keys(canonicalDraft).length,
            referenceLinks: [],
            canonicalReferenceSetHash: 'mobile-references-v1'
          })
        });
        return;
      }

      const body = route.request().postDataJSON() as {
        fields?: Array<{ field: string; value: string; provenance: string }>;
        expectedDraftVersion?: number;
      };
      expect(body.expectedDraftVersion).toBe(draftVersion);
      for (const field of body.fields ?? []) {
        canonicalDraft[field.field] = field.value;
        provenance[field.field] = field.provenance;
        savedEdits.push({ field: field.field, value: field.value });
      }
      draftVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          draft: versionedDraft(canonicalDraft, provenance),
          draftVersion,
          fieldCount: Object.keys(canonicalDraft).length
        })
      });
    });
    await page.route(`**/api/projects/${sessionId}/consent`, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, consent: { producerTransfer: true } })
    }));
    await page.route('**/api/chat', async (route) => {
      const stage = stages[chatCalls];
      if (!stage) throw new Error(`Unexpected mobile chat request ${chatCalls + 1}`);
      chatCalls += 1;
      Object.assign(canonicalDraft, stage.updates);
      for (const field of Object.keys(stage.updates)) {
        provenance[field] = stage.inferred.includes(field) ? 'inferred' : 'user-stated';
      }
      draftVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'draft_persisted',
          message: stage.message,
          draftUpdates: stage.updates,
          canonicalDraft,
          canonicalProvenance: provenance,
          draftVersion,
          currentStage: stage.currentStage,
          stageRecaps: [stage.recap],
          briefReady: chatCalls === stages.length,
          reviewPrompt: chatCalls === stages.length ? 'Your core brief is ready. Review it in the Brief tab before sending.' : null,
          missingFields: []
        })
      });
    });
    await page.route('**/api/leads/finalize', async (route) => {
      finalizeAttempts += 1;
      if (finalizeAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary send failure' })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          sessionId,
          qualificationStatus: 'qualified',
          persisted: true,
          queued: true,
          delivered: false,
          retryable: true,
          crmQueued: true,
          crmRevision: 1,
          approvedDraftVersion: draftVersion,
          approvalInputHash: 'mobile-approval-v1',
          approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
        })
      });
    });

    await page.goto('/preview');
    const input = await enterAiIntake(page);
    const sendMessage = page.getByRole('button', { name: 'Send message' });
    await expect(page.getByTestId('intake-stage-progress')).toHaveCount(0);
    await assertDirectContactRoutes(page);
    await assertMinimumTarget(sendMessage);

    await input.fill(`${originalWording}. The objective is to introduce it to customers.`);
    await input.press('Enter');
    await expect(page.getByRole('log').getByText(stages[0].recap, { exact: true })).toBeVisible();
    await assertMinimumTarget(page.getByRole('button', { name: 'Skip', exact: true }));
    await assertDirectContactRoutes(page);

    const tablist = page.getByRole('tablist', { name: 'Widget sections' });
    const chatTab = page.getByRole('tab', { name: 'Chat', exact: true });
    const briefTab = page.getByRole('tab', { name: 'Brief', exact: true });
    const chatPanel = page.getByRole('tabpanel', { name: 'Chat' });
    const briefPanel = page.getByRole('tabpanel', { name: 'Brief' });
    await expect(tablist).toBeVisible();
    await expect(chatPanel).toBeVisible();
    await expect(briefPanel).toBeHidden();
    await assertMinimumTarget(chatTab);
    await assertMinimumTarget(briefTab);
    await chatTab.focus();
    await chatTab.press('ArrowRight');
    await expect(briefTab).toBeFocused();
    await expect(briefTab).toHaveAttribute('aria-selected', 'true');
    await briefTab.press('ArrowLeft');
    await expect(chatTab).toBeFocused();
    await chatTab.press('End');
    await expect(briefTab).toBeFocused();
    await briefTab.press('Home');
    await expect(chatTab).toBeFocused();
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await assertMinimumTarget(page.getByRole('button', { name: 'Not sure yet', exact: true }));
    await assertDirectContactRoutes(page);
    await page.getByRole('button', { name: 'Not sure yet', exact: true }).click();
    await assertMinimumTarget(page.getByRole('button', { name: 'Skip', exact: true }));
    await assertDirectContactRoutes(page);
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByRole('log').getByText('Almost there. How should I address you?', { exact: true })).toBeVisible();
    await assertDirectContactRoutes(page);
    await input.fill('Jayden from Acme, jayden@example.com');
    await input.press('Enter');

    const reviewDirection = page.getByRole('status', { name: 'Brief ready' });
    await expect(reviewDirection).toHaveText('Your core brief is ready. Review it in the Brief tab.');
    await expect(reviewDirection).not.toContainText(/\b(left|right|panel|rail)\b/i);
    await briefTab.click();
    await expect(briefPanel).toBeVisible();
    await expect(chatPanel).toBeHidden();
    const review = page.getByTestId('review-panel');
    const originalRow = review.locator('[data-testid="brief-row"][data-row-key="projectScope"]');
    const summaryRow = review.locator('[data-testid="brief-row"][data-row-key="scopePolished"]');
    await expect(originalRow).toContainText('Original wording');
    await expect(summaryRow).toContainText('AI-drafted summary');
    await expect(originalRow).toContainText(originalWording);
    await expect(summaryRow).toContainText(aiSummary);

    const editOriginal = page.getByRole('button', { name: 'Edit original wording' });
    const editSummary = page.getByRole('button', { name: 'Edit ai-drafted summary' });
    await assertMinimumTarget(editOriginal);
    await assertMinimumTarget(editSummary);
    await editSummary.click();
    await assertMinimumTarget(page.getByRole('button', { name: 'Save ai-drafted summary' }));
    await assertMinimumTarget(page.getByRole('button', { name: 'Cancel editing ai-drafted summary' }));
    await page.getByRole('button', { name: 'Cancel editing ai-drafted summary' }).click();
    await editOriginal.click();
    const originalEditor = page.getByRole('textbox', { name: 'Original wording' });
    await originalEditor.press('Control+End');
    await originalEditor.press('Enter');
    await originalEditor.type('Keep the regional examples in the final film.');
    await expect(originalEditor).toHaveValue(`${originalWording}\nKeep the regional examples in the final film.`);
    const saveOriginal = page.getByRole('button', { name: 'Save original wording' });
    const cancelOriginal = page.getByRole('button', { name: 'Cancel editing original wording' });
    await assertMinimumTarget(saveOriginal);
    await assertMinimumTarget(cancelOriginal);
    await saveOriginal.click();
    await expect(originalRow).toContainText('User-edited wording');
    await expect(originalRow).toContainText('Keep the regional examples in the final film.');
    expect(savedEdits).toContainEqual({
      field: 'projectScope',
      value: `${originalWording}\nKeep the regional examples in the final film.`
    });

    const layout = await page.evaluate(() => {
      const selectors = [
        'html',
        '[role="dialog"][aria-label="Balance Assist"]',
        '#widget-brief-panel',
        '[data-testid="review-panel"]',
        '[data-row-key="projectScope"]',
        '[data-row-key="scopePolished"]'
      ];
      return selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing layout target ${selector}`);
        const bounds = element.getBoundingClientRect();
        const overflowingDescendants = Array.from(element.querySelectorAll<HTMLElement>('*'))
          .map((descendant) => {
            const descendantBounds = descendant.getBoundingClientRect();
            return {
              element: descendant.tagName.toLowerCase(),
              testId: descendant.dataset.testid ?? null,
              className: descendant.className,
              left: Math.round(descendantBounds.left),
              right: Math.round(descendantBounds.right)
            };
          })
          .filter(({ left, right }) => left < Math.floor(bounds.left) || right > Math.ceil(bounds.right));
        return { selector, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowingDescendants };
      });
    });
    for (const measurement of layout) {
      expect(measurement.scrollWidth, `${measurement.selector}: ${JSON.stringify(measurement.overflowingDescendants.slice(0, 8))}`).toBeLessThanOrEqual(measurement.clientWidth);
    }

    const sendBrief = page.getByRole('button', { name: 'Send brief to Balance' });
    await assertMinimumTarget(sendBrief);
    await sendBrief.click();
    const failure = page.getByRole('alert').filter({ hasText: 'The brief was not sent' });
    const retry = page.getByRole('button', { name: 'Retry sending brief' });
    await expect(failure).toContainText('The brief was not sent. Please retry or talk to the team without AI.');
    await expect(failure).not.toContainText(/\b(left|right|panel|rail)\b/i);
    await assertMinimumTarget(failure.getByRole('button', { name: 'Talk to the team without AI', exact: true }));
    await assertNoHorizontalOverflow(page.locator('html'), 'failure document');
    await assertNoHorizontalOverflow(page.locator('#widget-chat-panel'), 'failure Chat panel');
    await assertNoHorizontalOverflow(page.locator('#widget-brief-panel'), 'failure Brief panel');
    await assertNoHorizontalOverflow(failure, 'failure banner');
    await assertNoHorizontalOverflow(failure.locator('button, a'), 'failure actions');
    await chatTab.click();
    await expect(chatPanel).toBeVisible();
    await expect(failure).toBeVisible();
    await assertMinimumTarget(retry);
    await briefTab.click();
    await expect(briefTab).toHaveAttribute('aria-selected', 'true');
    await expect(failure).toBeVisible();
    await assertMinimumTarget(retry);
    await retry.click();

    const approvalConfirmation = page.getByTestId('approve-confirmation');
    await expect(approvalConfirmation).toContainText('Queued for the Balance team');
    await assertMinimumTarget(approvalConfirmation.getByRole('button', { name: 'Talk to a human team member' }));
    await assertNoHorizontalOverflow(page.locator('html'), 'queued document');
    await assertNoHorizontalOverflow(page.locator('#widget-chat-panel'), 'queued Chat panel');
    await assertNoHorizontalOverflow(page.locator('#widget-brief-panel'), 'queued Brief panel');
    await assertNoHorizontalOverflow(approvalConfirmation, 'queued approval');
    await assertNoHorizontalOverflow(approvalConfirmation.locator('button, a'), 'queued approval actions');
    const clearYes = page.getByRole('button', { name: 'Yes', exact: true });
    const clearNo = page.getByRole('button', { name: 'Not quite', exact: true });
    await assertMinimumTarget(clearYes);
    await assertMinimumTarget(clearNo);
    await clearNo.click();
    await expect(page.getByText('Thanks for the feedback.')).toBeVisible();
    await expect.poll(() => eventPayloads.filter(({ eventName }) => eventName === 'trust_feedback')).toEqual([{
      eventName: 'trust_feedback',
      properties: { dimension: 'clarity_helpfulness', response: 'not_quite' }
    }]);
    const motion = await page.locator('.balance-widget-motion').evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
        transform: style.transform
      };
    }));
    expect(motion.length).toBeGreaterThan(0);
    expect(motion).toEqual(motion.map(() => ({
      animationName: 'none',
      animationDuration: '0s',
      transitionDuration: '0s',
      transform: 'none'
    })));
    await expect(page.locator('.balance-widget-chat')).toHaveCSS('scroll-behavior', 'auto');
    expect(chatCalls).toBe(4);
    expect(finalizeAttempts).toBe(2);
  });

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
        actionHeight: actionBounds.height,
        dialogTop: bounds.top,
        dialogBottom: bounds.bottom,
        dialogPosition: getComputedStyle(dialog).position,
        dialogBorderRadius: Number.parseFloat(getComputedStyle(dialog).borderRadius)
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.dialogTop).toBe(0);
    expect(layout.dialogBottom).toBe(page.viewportSize()!.height);
    expect(layout.dialogPosition).toBe('fixed');
    expect(layout.dialogBorderRadius).toBe(0);
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
    let canonicalDraftVersion = 1;
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
            draftVersion: canonicalDraftVersion,
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
      canonicalDraftVersion += 1;
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
          draftVersion: canonicalDraftVersion,
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

    const human = page.getByRole('button', { name: 'Talk to the team without AI', exact: true });
    await expect(human).toBeVisible();
    await expect(human).toHaveClass(/balance-widget-action/);
    const humanBounds = await human.boundingBox();
    expect(humanBounds).not.toBeNull();
    expect(humanBounds!.width).toBeGreaterThanOrEqual(44);
    expect(humanBounds!.height).toBeGreaterThanOrEqual(44);
  });
});
