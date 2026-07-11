// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

const { finalizeLeadMock } = vi.hoisted(() => ({
  finalizeLeadMock: vi.fn(async () => ({
    ok: true,
    sessionId: 'mock-session-id',
    qualificationStatus: 'qualified',
    persisted: true,
    queued: true,
    delivered: false,
    retryable: false
  }))
}));

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return {
    ...actual,
    finalizeLead: finalizeLeadMock,
    fetchTeamMessages: vi.fn(async () => ({
      messages: [],
      fileRequestOpen: false,
      fileRequestNote: null,
      scheduleRequestOpen: false
    })),
    logEvent: vi.fn(async () => ({ ok: true, eventName: 'mock-event' })),
    createSession: vi.fn(async () => ({ sessionId: 'mock-session-id', status: 'new', sourceUrl: '' })),
    verifySession: vi.fn(async () => false)
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
    qualificationStatus: 'qualified',
    persisted: true,
    queued: true,
    delivered: false,
    retryable: false
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
          contactEmail: 'jayden@example.com',
          consentToShare: true
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
        persisted: true,
        queued: true,
        delivered: false,
        retryable: false
      });
    }
    return makeJsonResponse({});
  }) as unknown as typeof fetch;
}

describe('WidgetOverlay approved confirmation (Fix 5)', () => {
  test('after a successful approve, the rail renders a "Book a catch-up" CTA inside the green approved confirmation', async () => {
    mockWidgetFetch();

    render(<WidgetOverlay autoOpen={true} />);

    // Wait for chat input to mount.
    const input = (await waitFor(() => {
      const el = document.querySelector('input[placeholder]') as HTMLInputElement | null;
      if (!el) throw new Error('input not yet rendered');
      return el;
    })) as HTMLInputElement;

    // Drive a brief through the chat — the mocked /api/chat returns a complete draft.
    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    // Wait for the rail to mount.
    await waitFor(() => {
      const rail = document.querySelector('[data-testid="review-rail"]');
      expect(rail).not.toBeNull();
    });

    // Click approve.
    const approveButton = (await waitFor(() => {
      const btn = document.querySelector('[data-testid="approve-button"]') as HTMLButtonElement | null;
      if (!btn) throw new Error('approve-button not yet rendered');
      return btn;
    })) as HTMLButtonElement;

    fireEvent.click(approveButton);

    // After approval, the green confirmation banner + Book a catch-up CTA render.
    await waitFor(() => {
      const confirmation = document.querySelector('[data-testid="approve-confirmation"]');
      expect(confirmation).not.toBeNull();
      const bookCta = document.querySelector('[data-testid="book-catch-up-cta"]') as HTMLButtonElement | null;
      expect(bookCta).not.toBeNull();
      expect(bookCta?.textContent).toMatch(/book a catch-up/i);
    });

    // Brief summary count line is rendered with the expected "X of 8 fields captured" format.
    const countLine = document.querySelector('[data-testid="approve-confirmation-count"]') as HTMLElement | null;
    expect(countLine).not.toBeNull();
    expect(countLine?.textContent).toMatch(/\d+ of 8 fields captured/i);

    // Telegram status line shows "Telegram notification queued" since queued was true in finalize response.
    const telegramStatus = document.querySelector('[data-testid="approve-confirmation-telegram"]') as HTMLElement | null;
    expect(telegramStatus).not.toBeNull();
    expect(telegramStatus?.textContent).toMatch(/Telegram notification queued/i);
  });

  test('when finalize responds with queued=false and delivered=false, the rail shows "Telegram connection pending"', async () => {
    mockWidgetFetch();
    finalizeLeadMock.mockResolvedValueOnce({
      ok: true,
      sessionId: 'mock-session-id',
      qualificationStatus: 'qualified',
      persisted: true,
      queued: false,
      delivered: false,
      retryable: false
    });

    render(<WidgetOverlay autoOpen={true} />);

    const input = (await waitFor(() => {
      const el = document.querySelector('input[placeholder]') as HTMLInputElement | null;
      if (!el) throw new Error('input not yet rendered');
      return el;
    })) as HTMLInputElement;

    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      const rail = document.querySelector('[data-testid="review-rail"]');
      expect(rail).not.toBeNull();
    });

    const approveButton = (await waitFor(() => {
      const btn = document.querySelector('[data-testid="approve-button"]') as HTMLButtonElement | null;
      if (!btn) throw new Error('approve-button not yet rendered');
      return btn;
    })) as HTMLButtonElement;
    fireEvent.click(approveButton);

    await waitFor(() => {
      const telegramStatus = document.querySelector('[data-testid="approve-confirmation-telegram"]') as HTMLElement | null;
      expect(telegramStatus).not.toBeNull();
      expect(telegramStatus?.textContent).toMatch(/Telegram connection pending/i);
    });
  });
});
