import { test, expect, type Page } from '@playwright/test';

async function enterAiIntake(page: Page) {
  await page.getByRole('button', { name: 'Build a brief with AI' }).click();

  const input = page.getByPlaceholder(/Type your message|Message the team/i);
  await expect(input).toBeVisible();
  await expect(page.getByText(/What can I help you with today\?/i)).toBeVisible();

  return input;
}

async function assertDirectContactRoutes(page: Page) {
  await expect(page.getByRole('button', { name: 'Talk to the team without AI' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Email the team' })).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
  await expect(page.getByRole('link', { name: 'Book a call' })).toHaveAttribute('href', 'https://calendly.com/balance/test');
}

function versionedDraft(draft: Record<string, string>, provenance: Record<string, string>) {
  const updatedAt = '2026-07-17T10:00:00.000Z';
  return Object.fromEntries(Object.entries(draft).map(([field, value]) => [
    field,
    { value, provenance: provenance[field] ?? 'user-stated', updatedAt }
  ]));
}

test.describe('balance assist intake via persistent rail', () => {
  test('short intake confirmations do not fall back to the scripted summary flow', async ({ page }) => {
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
          sessionId: 'mock-session-id',
          persisted: true
        })
      });
    });

    let chatCallCount = 0;
    await page.route('**/api/chat', async (route) => {
      chatCallCount += 1;

      if (chatCallCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            outcome: 'draft_persisted',
            message: 'Got it. What kind of support do you need from Balance Studio?',
            draftUpdates: {
              projectScope: '30s animation for social media',
              scopePolished: '30s animation for social media'
            },
            canonicalDraft: {
              projectScope: '30s animation for social media',
              scopePolished: '30s animation for social media'
            },
            draftVersion: 1,
            currentStage: 'project',
            stageRecaps: [],
            briefReady: false,
            reviewPrompt: null,
            missingFields: ['service', 'timelineBand', 'budgetBand', 'contact']
          })
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'non_persistence',
          message: 'No problem. Tell me the kind of support you are exploring and I will shape it with you.',
        })
      });
    });

    await page.goto('/preview');

    const input = await enterAiIntake(page);

    await input.fill('30s animation for social media');
    await input.press('Enter');

    await expect(page.getByText(/What kind of support do you need from Balance Studio/i)).toBeVisible({ timeout: 5000 });

    await input.fill('ok');
    await input.press('Enter');

    await expect(
      page.getByText(/No problem\. Tell me the kind of support you are exploring and I will shape it with you\./i)
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/So far I have/i)).toHaveCount(0);
    expect(chatCallCount).toBe(2);
  });

  test('drives the four-stage canonical intake through correction, retry, and reapproval', async ({ page }) => {
    const sessionId = 'desktop-thesis-session';
    const originalWording = 'A launch film for our new accessibility initiative';
    const correctedWording = 'A launch film for our accessibility programme';
    const aiSummary = 'An uplifting launch film introducing an accessibility programme.';
    const canonicalDraft: Record<string, string> = {};
    const provenance: Record<string, string> = {};
    const chatRequests: Array<{ messages?: Array<{ content?: string }> }> = [];
    const expectedConsent = {
      scope: 'producer_transfer',
      granted: true,
      noticeVersion: '1.2'
    } as const;
    const consentRequests: Array<Record<string, unknown>> = [];
    const requestOrder: Array<
      | { kind: 'consent'; payload: Record<string, unknown> }
      | { kind: 'finalize'; attempt: number }
    > = [];
    let draftVersion = 0;
    let finalizeAttempts = 0;

    type StageFixture = {
      currentStage: 'audience' | 'planning' | 'references-contact';
      message: string;
      recap: string;
      updates: Record<string, string>;
      provenance: Record<string, 'user-stated' | 'inferred'>;
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
        provenance: { projectScope: 'user-stated', scopePolished: 'inferred' }
      },
      {
        currentStage: 'planning',
        message: 'Timeline helps with planning and feasibility, while budget helps us suggest realistic formats and scope. What timeline are you working with?',
        recap: 'So far: audience: Not sure yet; intended outputs: Skip.',
        updates: { audience: 'Not sure yet', intendedOutputs: 'Skip' },
        provenance: {}
      },
      {
        currentStage: 'references-contact',
        message: 'Would you like to add any references, or Skip?',
        recap: 'So far: timeline: Not sure yet; budget: Prefer not to share.',
        updates: { timelineBand: 'Not sure yet', budgetBand: 'Prefer not to share' },
        provenance: {}
      },
      {
        currentStage: 'references-contact',
        message: 'Your core brief is ready. Review the saved brief before sending it to Balance.',
        recap: 'So far: references: Skipped; contact name: Jayden; contact email: jayden@example.com.',
        updates: {
          referencesStatus: 'skipped',
          contactName: 'Jayden',
          contactCompany: 'Acme',
          contactEmail: 'jayden@example.com'
        },
        provenance: {}
      }
    ];

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
          sessionId,
          persisted: true
        })
      });
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
            canonicalReferenceSetHash: 'references-v1',
            ...(finalizeAttempts > 1 ? { crmRevision: finalizeAttempts - 1 } : {})
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

    await page.route(`**/api/projects/${sessionId}/consent`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      consentRequests.push(payload);
      requestOrder.push({ kind: 'consent', payload });
      const exactPayload =
        route.request().method() === 'POST' &&
        Object.keys(payload).sort().join(',') === 'granted,noticeVersion,scope' &&
        payload.scope === expectedConsent.scope &&
        payload.granted === expectedConsent.granted &&
        payload.noticeVersion === expectedConsent.noticeVersion;
      if (!exactPayload) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, consent: { producerTransfer: false } })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, consent: { producerTransfer: true } })
      });
    });

    await page.route('**/api/chat', async (route) => {
      const body = route.request().postDataJSON() as { messages?: Array<{ content?: string }> };
      chatRequests.push(body);
      const stage = stages[chatRequests.length - 1];
      if (!stage) throw new Error(`Unexpected chat request ${chatRequests.length}`);
      Object.assign(canonicalDraft, stage.updates);
      Object.assign(provenance, Object.fromEntries(Object.keys(stage.updates).map((field) => [field, 'user-stated'])), stage.provenance);
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
          briefReady: chatRequests.length === stages.length,
          reviewPrompt: chatRequests.length === stages.length ? 'Your core brief is ready. Review it before sending.' : null,
          missingFields: []
        })
      });
    });

    await page.route('**/api/leads/finalize', async (route) => {
      finalizeAttempts += 1;
      requestOrder.push({ kind: 'finalize', attempt: finalizeAttempts });
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
          crmRevision: finalizeAttempts - 1,
          approvedDraftVersion: draftVersion,
          approvalInputHash: `approval-${finalizeAttempts}`,
          approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
        })
      });
    });

    await page.goto('/preview');

    const input = await enterAiIntake(page);

    const rail = page.getByTestId('review-rail');
    await expect(rail).toHaveCount(0);
    await expect(page.getByTestId('intake-stage-progress')).toHaveCount(0);
    await assertDirectContactRoutes(page);

    await input.fill(`${originalWording}. The objective is to introduce it to customers.`);
    await input.press('Enter');

    await expect(rail).toBeVisible();
    await expect(page.getByRole('log').getByText('Who is this for?', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('log').getByText(stages[0].recap, { exact: true })).toBeVisible();
    await expect(rail.getByText('Original wording', { exact: true })).toBeVisible();
    await expect(rail.getByText(originalWording, { exact: true })).toBeVisible();
    await expect(rail.getByText('AI-drafted summary', { exact: true })).toBeVisible();
    await expect(rail.getByText(aiSummary, { exact: true })).toBeVisible();
    const desktopColumns = await page.evaluate(() => {
      const railBounds = document.querySelector<HTMLElement>('[data-testid="review-rail"]')!.getBoundingClientRect();
      const chatBounds = document.querySelector<HTMLElement>('#widget-chat-panel')!.getBoundingClientRect();
      return {
        railWidth: railBounds.width,
        railRight: railBounds.right,
        chatLeft: chatBounds.left,
        chatWidth: chatBounds.width
      };
    });
    expect(desktopColumns.railWidth).toBeGreaterThanOrEqual(280);
    expect(desktopColumns.chatWidth).toBeGreaterThan(0);
    expect(desktopColumns.railRight).toBeLessThanOrEqual(desktopColumns.chatLeft + 1);
    await assertDirectContactRoutes(page);

    await page.getByRole('button', { name: 'Edit original wording' }).click();
    await page.getByRole('textbox', { name: 'Original wording' }).fill(correctedWording);
    await page.getByRole('button', { name: 'Save original wording' }).click();
    await expect(rail.getByText(correctedWording, { exact: true })).toBeVisible();
    await expect(rail.getByText(originalWording, { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByRole('log').getByText(stages[1].message, { exact: true })).toBeVisible();
    await expect(page.getByRole('log').getByText(stages[1].recap, { exact: true })).toBeVisible();
    await expect(rail.getByText('Not sure yet', { exact: true })).toBeVisible();
    await expect(rail.getByText('Skip', { exact: true })).toBeVisible();
    await expect(rail.getByText(correctedWording, { exact: true })).toBeVisible();
    await assertDirectContactRoutes(page);

    await page.getByRole('button', { name: 'Not sure yet', exact: true }).click();
    await expect(page.getByRole('log').getByText(stages[2].message, { exact: true })).toBeVisible();
    await expect(page.getByRole('log').getByText(stages[2].recap, { exact: true })).toBeVisible();
    await expect(rail.getByText('Prefer not to share', { exact: true })).toBeVisible();
    await assertDirectContactRoutes(page);

    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByRole('log').getByText('Almost there. How should I address you?', { exact: true })).toBeVisible();
    await input.fill('Jayden from Acme, jayden@example.com');
    await input.press('Enter');
    await expect(page.getByRole('status', { name: 'Brief ready' })).toHaveCount(0);
    await expect(page.getByRole('log').getByText(stages[3].recap, { exact: true })).toBeVisible();
    const reviewPanel = page.getByTestId('review-panel');
    await expect(reviewPanel).toHaveAttribute('data-mode', 'summary');
    await expect(reviewPanel.getByText('Core brief ready', { exact: true })).toBeVisible();
    await expect(reviewPanel.getByText('Optional details', { exact: true })).toBeVisible();
    await expect(reviewPanel).not.toContainText('8 of 8');
    await assertDirectContactRoutes(page);

    const approveButton = page.getByRole('button', { name: 'Send brief to Balance' });
    await approveButton.click();
    const failure = page.getByRole('alert').filter({ hasText: 'The brief was not sent' });
    await expect(failure).toContainText('The brief was not sent');
    await expect(page.getByRole('button', { name: 'Retry sending brief' })).toBeVisible();
    await expect(input).toBeVisible();
    await page.getByRole('button', { name: 'Retry sending brief' }).click();
    await expect(page.getByTestId('approve-confirmation')).toContainText('Queued for the Balance team');
    await expect(page.getByTestId('approve-confirmation')).not.toContainText(/delivered|reviewed/i);
    expect(requestOrder.slice(0, 4)).toEqual([
      { kind: 'consent', payload: expectedConsent },
      { kind: 'finalize', attempt: 1 },
      { kind: 'consent', payload: expectedConsent },
      { kind: 'finalize', attempt: 2 }
    ]);

    const samePanel = page.getByTestId('review-panel');
    const reviewPanelHandle = await samePanel.elementHandle();
    expect(reviewPanelHandle).not.toBeNull();
    await samePanel.evaluate((node) => {
      if (!(node instanceof HTMLElement)) throw new Error('Review panel must be an HTML element');
      node.dataset.e2eIdentity = 'desktop-review-panel';
      (window as Window & { __desktopReviewPanel?: Element }).__desktopReviewPanel = node;
    });
    await samePanel.getByRole('button', { name: 'Edit project objective' }).click();
    await page.getByRole('textbox', { name: 'Project objective' }).fill('Build awareness and prompt sign-ups.');
    await page.getByRole('button', { name: 'Save project objective' }).click();
    await expect(samePanel).toBeVisible();
    const reapproveButton = page.getByRole('button', { name: 'Send updated brief to Balance' });
    await expect(reapproveButton).toBeVisible();
    await reapproveButton.click();
    await expect(page.getByTestId('approve-confirmation')).toContainText('Queued for the Balance team');
    expect(requestOrder.slice(-2)).toEqual([
      { kind: 'consent', payload: expectedConsent },
      { kind: 'finalize', attempt: 3 }
    ]);
    expect(await samePanel.evaluate((node) => {
      if (!(node instanceof HTMLElement)) return false;
      return node.dataset.e2eIdentity === 'desktop-review-panel' &&
        (window as Window & { __desktopReviewPanel?: Element }).__desktopReviewPanel === node;
    })).toBe(true);
    expect(await reviewPanelHandle!.evaluate((node) => {
      if (!(node instanceof HTMLElement)) return false;
      return node.isConnected && node.dataset.e2eIdentity === 'desktop-review-panel';
    })).toBe(true);

    expect(consentRequests).toEqual([expectedConsent, expectedConsent, expectedConsent]);

    expect(chatRequests).toHaveLength(4);
    expect(chatRequests.map((request) => request.messages?.at(-1)?.content)).toEqual([
      `${originalWording}. The objective is to introduce it to customers.`,
      'Skip',
      'Not sure yet',
      'Jayden from Acme, jayden@example.com'
    ]);
    await expect(page.getByRole('dialog', { name: 'Balance Assist' })).not.toContainText(
      /score|qualified|unqualified|misfit|crm|telegram|revision/i
    );
  });
});
