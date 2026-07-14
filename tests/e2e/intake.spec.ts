import { test, expect, type Page } from '@playwright/test';

async function enterAiIntake(page: Page) {
  await page.getByTestId('consent-button').click();
  await page.getByRole('button', { name: /start with balance assist/i }).click();

  const input = page.getByPlaceholder(/Type your message|Message the team/i);
  await expect(input).toBeVisible();
  await expect(page.getByText(/What can I help you with today\?/i)).toBeVisible();

  return input;
}

// Playwright E2E covering the tool-calling intake path against the
// gated persistent-rail layout (reintroduced in fix/brief-rail-gating):
//   1. /preview mounts the widget with autoOpen=true; until the user
//      sends an intake-bearing message, hasProjectIntent is false and
//      the left rail is hidden (chat fills the widget width).
//   2. user types a free-form project prompt into the intro step
//   3. /api/chat is intercepted and returns a complete brief via
//      `record_brief_updates`-style draftUpdates + briefReady: true
//   4. once the AI captures any reviewable field, hasProjectIntent
//      flips to true and the persistent left rail (ReviewPanel) appears
//   5. the rail auto-switches from "essentials" to "summary" mode and
//      shows the "Approve & send to team" CTA once all 8 reviewable
//      fields are captured
//   6. clicking that CTA hits /api/leads/finalize (mocked) and the
//      widget appends the post-approval confirmation
//
// The widget is mounted on /preview with `autoOpen={true}`, so the chat
// surface is visible the moment the page loads — but the rail only
// appears after the AI confirms project intent.

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
            message: 'Got it. What kind of support do you need from Balance Studio?',
            draftUpdates: {
              projectScope: '30s animation for social media',
              scopePolished: '30s animation for social media'
            },
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
          message: 'No problem. Tell me the kind of support you are exploring and I will shape it with you.',
          draftUpdates: {},
          briefReady: false,
          reviewPrompt: null,
          missingFields: ['service', 'timelineBand', 'budgetBand', 'contact']
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

  test('rail is gated on hasProjectIntent, then auto-switches to summary and triggers send', async ({ page }) => {
    const consentRequests: Array<{ scope?: string; granted?: boolean }> = [];
    await page.route('**/api/sessions/inspect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, exists: false })
      });
    });

    // Mock /api/sessions so ensureSession() inside the widget can resolve
    // when the user clicks "Approve & send to team".
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

    await page.route('**/api/projects/mock-session-id/consent', async (route) => {
      consentRequests.push(await route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, consent: { producerTransfer: true } })
      });
    });

    // Mock /api/chat to return a complete-brief response. The widget
    // renders `data.message` in a chat bubble, so the visible text
    // after the user submits is the `message` field below.
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Your brief is ready. Review it on the left and approve when you are happy with it.',
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
          reviewPrompt: 'Your brief is ready. Review it on the left and approve when you are happy with it.',
          missingFields: []
        })
      });
    });

    // Mock /api/leads/finalize — this is what the rail's "Approve &
    // send to team" CTA ultimately calls.
    await page.route('**/api/leads/finalize', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          sessionId: 'mock-session-id',
          qualificationStatus: 'qualified',
          persisted: true
        })
      });
    });

    await page.goto('/preview');

    const input = await enterAiIntake(page);

    // The rail is gated on hasProjectIntent. Before the user has sent
    // any intake-bearing message, the rail must NOT be in the DOM.
    const rail = page.getByTestId('review-rail');
    await expect(rail).toHaveCount(0);

    // Drive a free-form prompt into the intro step. Pressing Enter
    // triggers handleSubmitText -> processFlowAnswer -> handleLLMResponse,
    // which fetches /api/chat (now mocked).
    await input.fill('30s animation for social media');
    await input.press('Enter');

    // The bot reply from the mocked /api/chat should appear in the chat
    // within 5 seconds. The widget now guarantees a fallback bot reply even
    // if the LLM call fails, so this should never time out silently.
    await expect(page.getByText(/Your brief is ready/i)).toBeVisible({ timeout: 5000 });

    // Once the AI merges the draftUpdates from /api/chat,
    // hasProjectIntent flips to true and the persistent left rail
    // mounts to the left of the chat column.
    await expect(rail).toBeVisible();

    // Once the merged draft satisfies `isBriefReadyForApproval`, the
    // rail auto-switches from "essentials" to "summary" mode and the
    // "Approve & send to team" CTA renders inline in the rail.
    const approveButton = page.getByRole('button', { name: /approve.*send to team/i });
    await expect(approveButton).toBeVisible();

    // The rail should also report summary mode via data-mode.
    await expect(page.getByTestId('review-panel')).toHaveAttribute('data-mode', 'summary');

    // Click approve. This calls /api/leads/finalize (mocked) and the
    // widget appends the post-approval confirmation message.
    // The Approve CTA runs a continuous pulse-glow animation (scale +
    // box-shadow), so we click with `force: true` to bypass Playwright's
    // "element is stable" wait — the click handler itself is what we
    // care about, and the button is reachable throughout the animation.
    await approveButton.click({ force: true });

    await expect.poll(() => consentRequests).toContainEqual(
      expect.objectContaining({ scope: 'producer_transfer', granted: true })
    );

    // The chat input must still be visible — the rail sits to the
    // left of the chat, never covering it.
    await expect(input).toBeVisible();

    // After approval, the widget posts a bot confirmation that the
    // brief is approved and ready for the Balance team.
    await expect(page.getByText(/approved and ready for the Balance team/i)).toBeVisible();
  });
});
