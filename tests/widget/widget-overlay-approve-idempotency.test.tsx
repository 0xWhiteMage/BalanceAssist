// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { finalizeLeadMock } = vi.hoisted(() => ({
  finalizeLeadMock: vi.fn(async () => ({
    ok: true,
    sessionId: 'mock-session-id',
    qualificationStatus: 'qualified'
  }))
}));

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return {
    ...actual,
    finalizeLead: finalizeLeadMock,
    fetchTeamMessages: vi.fn(async () => ({ messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })),
    logEvent: vi.fn(async () => ({ ok: true, eventName: 'mock-event' })),
    createSession: vi.fn(async () => ({ sessionId: 'mock-session-id', status: 'new', sourceUrl: '', persisted: true })),
    getCurrentSession: vi.fn(async () => null)
  };
});

import { WidgetOverlay } from '@/components/widget/widget-overlay';

beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // no-op for jsdom
    };
  }
});

afterEach(() => {
  finalizeLeadMock.mockReset();
  finalizeLeadMock.mockResolvedValue({
    ok: true,
    sessionId: 'mock-session-id',
    qualificationStatus: 'qualified'
  });
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function makeJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function mockWidgetFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/sessions') && init?.method === 'POST') {
      return makeJsonResponse({ sessionId: 'mock-session-id', capability: 'mock-session-id.mock-cap', expiresAt: new Date(Date.now() + 86400000).toISOString(), persisted: true });
    }
    if (url.includes('/api/chat')) {
      return makeJsonResponse({
        message: 'Your brief is ready. Tap the tab on the right to review.',
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
        reviewPrompt: 'Your brief is ready. Tap the tab on the right to review.',
        missingFields: []
      });
    }
    if (url.includes('/api/leads/finalize')) {
      return makeJsonResponse({
        ok: true,
        sessionId: 'mock-session-id',
        qualificationStatus: 'qualified',
        persisted: true
      });
    }
    return makeJsonResponse({});
  }) as unknown as typeof fetch;
}

async function startAiConversation() {
  fireEvent.click(await screen.findByTestId('consent-button'));
  fireEvent.click(await screen.findByRole('button', { name: /start with balance assist/i }));

  const input = (await waitFor(() => {
    const el = document.querySelector('input[placeholder]') as HTMLInputElement | null;
    if (!el) throw new Error('input not yet rendered');
    return el;
  })) as HTMLInputElement;

  await waitFor(() => {
    expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
  }, { timeout: 7000 });

  return input;
}

describe('WidgetOverlay approve idempotency', () => {
  test('clicking the Approve button twice in a row results in a single /api/leads/finalize call', async () => {
    mockWidgetFetch();

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    // Type a project prompt and submit. This triggers /api/chat, which
    // returns a complete brief — flipping hasProjectIntent=true and pushing
    // the rail into summary mode with the Approve CTA visible.
    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      const rail = document.querySelector('[data-testid="review-rail"]');
      expect(rail).not.toBeNull();
    });

    let approveButton: HTMLButtonElement | null = null;
    await waitFor(() => {
      approveButton = document.querySelector('[data-testid="approve-button"]') as HTMLButtonElement | null;
      expect(approveButton).not.toBeNull();
    });

    if (!approveButton) throw new Error('Approve button missing');
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);

    // Wait for the async finalizeLead call (post-await microtasks).
    await waitFor(() => {
      expect(finalizeLeadMock).toHaveBeenCalled();
    });

    // Give any rogue duplicate call enough time to arrive.
    await new Promise((r) => setTimeout(r, 200));

    expect(finalizeLeadMock).toHaveBeenCalledTimes(1);
  });
});
