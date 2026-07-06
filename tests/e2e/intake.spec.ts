import { test, expect } from '@playwright/test';

// Playwright E2E covering the tool-calling intake path:
//   1. user types a free-form project prompt
//   2. /api/chat is intercepted and returns a complete brief via the
//      `record_brief_updates` tool-call shape
//   3. the edge tab (BriefPanelTab) appears on the right of the chat
//   4. the review screen (BriefReviewScreen) renders with all fields filled
//   5. clicking "Send to Balance team" hits /api/leads/finalize and the
//      widget shows the post-send confirmation
//
// The widget is mounted on /preview with `autoOpen={true}`, so the chat
// surface is already visible when the page loads — no launcher click needed.

test.describe('balance assist intake via review screen', () => {
  test('captures a brief, opens the edge tab, and triggers send', async ({ page }) => {
    // Mock /api/sessions so ensureSession() inside the widget can resolve
    // when the user clicks "Send to Balance team".
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

    // Mock /api/chat to return a complete-brief tool-call response.
    // The widget renders `data.message` in a chat bubble, so the visible
    // text after the user submits is the `message` field below.
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Your brief is ready. Tap the tab on the right to review.',
          draftUpdates: {
            service: 'production',
            projectType: 'Video',
            projectScope: '30s animation for social media',
            timelineBand: '1-2-months',
            budgetBand: '20k-50k',
            contactName: 'Jayden',
            contactEmail: 'jayden@example.com'
          },
          briefReady: true,
          reviewPrompt: 'Your brief is ready. Tap the tab on the right to review.',
          missingFields: []
        })
      });
    });

    // Mock /api/leads/finalize — this is what the "Send to Balance team"
    // button ultimately calls.
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

    // The widget opens automatically on /preview. Wait for the chat
    // input, which is the simplest signal that the widget has mounted.
    const input = page.getByPlaceholder(/Type your message|Message the team/i);
    await expect(input).toBeVisible();

    // Drive a free-form prompt into the intro step. Pressing Enter
    // triggers handleSubmitText -> processFlowAnswer -> handleLLMResponse,
    // which fetches /api/chat (now mocked).
    await input.fill('30s animation for social media');
    await input.press('Enter');

    // The bot reply from the mocked /api/chat should appear in the chat.
    await expect(page.getByText(/Your brief is ready/i)).toBeVisible();

    // Open the brief panel via the edge tab on the right side of the
    // chat. BriefPanelTab uses aria-label="Open project brief" when
    // closed and "Close project brief" when open.
    await page.getByRole('button', { name: /Open project brief/i }).click();

    // The review screen should be visible with its primary CTA.
    const sendButton = page.getByRole('button', { name: /Send to Balance team/i });
    await expect(sendButton).toBeVisible();

    // Click send. This calls /api/leads/finalize (mocked) and the widget
    // appends a confirmation message via botSay.
    await sendButton.click();

    // After send, the widget says the brief is approved and ready for
    // the Balance team.
    await expect(page.getByText(/approved/i)).toBeVisible();
  });
});