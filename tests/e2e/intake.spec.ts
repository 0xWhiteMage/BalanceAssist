import { test, expect } from '@playwright/test';

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
  test('rail is gated on hasProjectIntent, then auto-switches to summary and triggers send', async ({ page }) => {
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

    // The intro step plays three scripted bot messages before the user
    // can submit. handleSubmitText returns early while isTyping is true,
    // so wait for the final intro prompt to be visible (i.e. isTyping
    // is back to false) before driving the user input.
    await expect(page.getByText(/What can I help you with today\?/i)).toBeVisible();

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

    // The chat input must still be visible — the rail sits to the
    // left of the chat, never covering it.
    await expect(input).toBeVisible();

    // After approval, the widget posts a bot confirmation that the
    // brief is approved and ready for the Balance team.
    await expect(page.getByText(/approved and ready for the Balance team/i)).toBeVisible();
  });
});