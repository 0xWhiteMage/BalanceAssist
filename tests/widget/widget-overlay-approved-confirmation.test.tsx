// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    createSession: vi.fn(async () => ({ sessionId: 'mock-session-id', status: 'new', sourceUrl: '', persisted: true })),
    getCurrentSession: vi.fn(async () => null)
  };
});

vi.mock('@/components/chat/calendly-embed', () => ({
  CalendlyEmbed: ({ onBack, onScheduled }: { onBack: () => void; onScheduled?: () => void | Promise<void> }) => (
    <div data-testid="mock-calendly-embed">
      <button type="button" onClick={onBack}>Back to chat</button>
      <button type="button" onClick={() => void onScheduled?.()}>Complete booking</button>
    </div>
  )
}));

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
        persisted: true,
        queued: true,
        delivered: false,
        retryable: false
      });
    }
    if (url.includes('/api/projects/mock-session-id/consent')) {
      return makeJsonResponse({ ok: true, consent: { analysis: false, producerTransfer: true } });
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

describe('WidgetOverlay approved confirmation (Fix 5)', () => {
  test('does not update unmounted state or raise a window error when delayed approval output completes', async () => {
    mockWidgetFetch();
    let resolveFinalize: ((value: Awaited<ReturnType<typeof finalizeLeadMock>>) => void) | undefined;
    finalizeLeadMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFinalize = resolve;
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const windowErrors: ErrorEvent[] = [];
    const onWindowError = (event: ErrorEvent) => windowErrors.push(event);
    window.addEventListener('error', onWindowError);

    try {
      const { unmount } = render(<WidgetOverlay autoOpen={true} />);
      const input = await startAiConversation();
      fireEvent.change(input, { target: { value: '30s animation for social media' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

      const approveButton = await waitFor(() => {
        const button = document.querySelector('[data-testid="approve-button"]') as HTMLButtonElement | null;
        if (!button) throw new Error('approve-button not yet rendered');
        return button;
      });
      fireEvent.click(approveButton);
      await waitFor(() => expect(finalizeLeadMock).toHaveBeenCalledTimes(1));

      unmount();
      await act(async () => {
        resolveFinalize?.({
          ok: true,
          sessionId: 'mock-session-id',
          qualificationStatus: 'qualified',
          persisted: true,
          queued: true,
          delivered: false,
          retryable: false
        });
        await Promise.resolve();
      });

      expect(consoleError).not.toHaveBeenCalled();
      expect(windowErrors).toEqual([]);
    } finally {
      window.removeEventListener('error', onWindowError);
      consoleError.mockRestore();
    }
  });

  test('after a successful approve, the rail renders a "Book a catch-up" CTA inside the green approved confirmation', async () => {
    mockWidgetFetch();

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

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

    // The confirmation copy stays truthful when delivery is queued but not verified.
    const countLine = document.querySelector('[data-testid="approve-confirmation-count"]') as HTMLElement | null;
    expect(countLine).not.toBeNull();
    expect(countLine?.textContent).toMatch(/Approval saved\. Team notification queued\./i);

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

    const input = await startAiConversation();

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

  test('does not mark the brief approved when finalize reports persisted=false', async () => {
    mockWidgetFetch();
    finalizeLeadMock.mockResolvedValueOnce({
      ok: true,
      sessionId: 'mock-session-id',
      qualificationStatus: 'qualified',
      persisted: false,
      queued: false,
      delivered: false,
      retryable: false
    });

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

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
      expect(document.querySelector('[data-testid="approve-confirmation"]')).toBeNull();
      expect(screen.getByText(/brief could not be saved/i)).toBeInTheDocument();
    });
  }, 10000);

  test('does not finalize until producer-transfer consent has been recorded', async () => {
    mockWidgetFetch();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        return makeJsonResponse({ sessionId: 'mock-session-id', capability: 'mock-session-id.mock-cap', expiresAt: new Date(Date.now() + 86400000).toISOString(), persisted: true });
      }
      if (url.includes('/api/chat')) {
        return makeJsonResponse({ message: 'Ready.', draftUpdates: { service: 'production', projectType: 'Video', projectScope: '30s animation', timelineBand: '1-2-months', budgetBand: '20k-50k', contactName: 'Jayden', contactCompany: 'Acme', contactEmail: 'jayden@example.com' }, briefReady: true, missingFields: [] });
      }
      if (url.includes('/api/projects/mock-session-id/consent')) {
        return makeJsonResponse({ ok: false }, 500);
      }
      return makeJsonResponse({});
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);
    const input = await startAiConversation();
    fireEvent.change(input, { target: { value: '30s animation' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    const approveButton = await waitFor(() => {
      const button = document.querySelector('[data-testid="approve-button"]') as HTMLButtonElement | null;
      if (!button) throw new Error('approve-button not yet rendered');
      return button;
    });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(finalizeLeadMock).not.toHaveBeenCalled();
      expect(screen.getByText(/could not confirm consent/i)).toBeInTheDocument();
    });
  }, 10000);

  test('after Calendly completes without verified server confirmation, the widget stays truthful about team notification', async () => {
    mockWidgetFetch();

    render(<WidgetOverlay autoOpen={true} calendlyUrlOverride="https://calendly.com/balance/15-minute-call" />);

    const input = await startAiConversation();

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
      const bookCta = document.querySelector('[data-testid="book-catch-up-cta"]') as HTMLButtonElement | null;
      expect(bookCta).not.toBeNull();
    });

    fireEvent.click(document.querySelector('[data-testid="book-catch-up-cta"]') as HTMLButtonElement);

    await waitFor(() => {
      const embed = document.querySelector('[data-testid="mock-calendly-embed"]');
      expect(embed).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /complete booking/i }));

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/still verifying that the balance team received it/i);
    });
    expect(document.body.textContent).not.toMatch(/notified automatically/i);
  }, 10000);
});
