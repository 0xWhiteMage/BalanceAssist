import { test, expect } from '@playwright/test';

// Playwright E2E covering the tool-calling intake path against the new
// persistent-rail layout (introduced in commit c892654):
//   1. user types a free-form project prompt
//   2. /api/chat is intercepted and returns a complete brief via
//      `record_brief_updates`-style draftUpdates + briefReady: true
//   3. the persistent left rail (ReviewPanel) is visible from the moment
//      the widget opens, with no slide-out / edge tab interaction needed
//   4. the rail auto-switches from "essentials" to "summary" mode and
//      shows the "Approve & send to team" CTA once all 8 reviewable
//      fields are captured
//   5. clicking that CTA hits /api/leads/finalize (mocked) and the
//      widget appends the post-approval confirmation
//
// The widget is mounted on /preview with `autoOpen={true}`, so the chat
// surface AND the left rail are both already visible when the page
// loads — no launcher click and no rail-opener click needed.

test.describe('balance assist intake via persistent rail', () => {
  test('shows the rail from open, auto-switches to summary, and triggers send', async ({ page }) => {
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

    // The widget opens automatically on /preview. Wait for the chat
    // input, which is the simplest signal that the widget has mounted.
    const input = page.getByPlaceholder(/Type your message|Message the team/i);
    await expect(input).toBeVisible();

    // The persistent left rail must be visible from the moment the
    // widget opens — no slide-out / edge-tab click needed.
    const rail = page.getByTestId('review-rail');
    await expect(rail).toBeVisible();

    // Drive a free-form prompt into the intro step. Pressing Enter
    // triggers handleSubmitText -> processFlowAnswer -> handleLLMResponse,
    // which fetches /api/chat (now mocked).
    await input.fill('30s animation for social media');
    await input.press('Enter');

    // The bot reply from the mocked /api/chat should appear in the chat.
    await expect(page.getByText(/Your brief is ready/i)).toBeVisible();

    // Once the merged draft satisfies `isBriefReadyForApproval`, the
    // rail auto-switches from "essentials" to "summary" mode and the
    // "Approve & send to team" CTA renders inline in the rail.
    const approveButton = page.getByRole('button', { name: /approve.*send to team/i });
    await expect(approveButton).toBeVisible();

    // The rail should also report summary mode via data-mode.
    await expect(page.getByTestId('review-panel')).toHaveAttribute('data-mode', 'summary');

    // Click approve. This calls /api/leads/finalize (mocked) and the
    // widget appends the post-approval confirmation message.
    await approveButton.click();

    // The chat input must still be visible — the rail sits to the
    // left of the chat, never covering it.
    await expect(input).toBeVisible();

    // After approval, the widget posts a bot confirmation that the
    // brief is approved and ready for the Balance team.
    await expect(page.getByText(/approved and ready for the Balance team/i)).toBeVisible();
  });
});