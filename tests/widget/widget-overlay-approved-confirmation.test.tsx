// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { finalizeLeadMock, logEventMock } = vi.hoisted(() => ({
  finalizeLeadMock: vi.fn(async () => ({
    ok: true,
    sessionId: 'mock-session-id',
    qualificationStatus: 'qualified',
    persisted: true,
    queued: true,
    delivered: false,
    retryable: false,
    crmQueued: true,
    crmRevision: 1,
    approvedDraftVersion: 1,
    approvalInputHash: 'approval-hash-v1',
    approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
  })),
  logEventMock: vi.fn(async () => ({ ok: true, eventName: 'mock-event' }))
}));

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return {
    ...actual,
    finalizeLead: finalizeLeadMock,
    fetchTeamMessages: vi.fn(async () => ({
      outgoingStatus: null,
      messages: [],
      fileRequestOpen: false,
      fileRequestNote: null,
      scheduleRequestOpen: false
    })),
    logEvent: logEventMock,
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
  logEventMock.mockReset();
  logEventMock.mockResolvedValue({ ok: true, eventName: 'mock-event' });
  finalizeLeadMock.mockReset();
  finalizeLeadMock.mockResolvedValue({
    ok: true,
    sessionId: 'mock-session-id',
    qualificationStatus: 'qualified',
      persisted: true,
      queued: true,
      delivered: false,
      retryable: false,
      crmQueued: true,
      crmRevision: 1,
      approvedDraftVersion: 1,
      approvalInputHash: 'approval-hash-v1',
      approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
  });
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  setMobileViewport(false);
});

function makeJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function setMobileViewport(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)' ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
    }))
  });
}

function setResponsiveViewport(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      get matches() { return query === '(max-width: 639px)' ? matches : false; },
      media: query,
      onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: vi.fn()
    }))
  });
  return (nextMatches: boolean) => {
    matches = nextMatches;
    const event = { matches: nextMatches, media: '(max-width: 639px)' } as MediaQueryListEvent;
    listeners.forEach((listener) => listener(event));
  };
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
        outcome: 'draft_persisted',
        canonicalDraft: {
          service: 'production', projectType: 'Video', projectScope: '30s animation for social media',
          timelineBand: '1-2-months', budgetBand: '20k-50k', contactName: 'Jayden',
          contactCompany: 'Acme', contactEmail: 'jayden@example.com'
        },
        draftVersion: 1,
        currentStage: 'project',
        stageRecaps: [],
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
        retryable: false,
        crmQueued: true,
        crmRevision: 1,
        approvedDraftVersion: 1,
        approvalInputHash: 'approval-hash-v1',
        approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
      });
    }
    if (url.includes('/api/projects/mock-session-id/consent')) {
      return makeJsonResponse({ ok: true, consent: { analysis: false, producerTransfer: true } });
    }
    return makeJsonResponse({});
  }) as unknown as typeof fetch;
}

async function startAiConversation() {
  fireEvent.click(await screen.findByRole('button', { name: 'Build a brief with AI' }));

  const input = (await waitFor(() => {
    const el = document.querySelector('textarea[placeholder]') as HTMLTextAreaElement | null;
    if (!el) throw new Error('input not yet rendered');
    return el;
  })) as HTMLTextAreaElement;

  await waitFor(() => {
    expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
  }, { timeout: 7000 });

  return input;
}

describe('WidgetOverlay approved confirmation (Fix 5)', () => {
  test('uses the rail on desktop and one live ready direction on mobile without entering chat history', async () => {
    const resize = setResponsiveViewport(false);
    mockWidgetFetch();
    render(<WidgetOverlay autoOpen={true} />);
    const input = await startAiConversation();
    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('Core brief ready', {}, { timeout: 7000 })).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Brief ready' })).toBeNull();
    expect(screen.getByRole('log')).not.toHaveTextContent(/Your core brief is ready|tab on the right/i);

    act(() => resize(true));
    const readyStatus = screen.getByRole('status', { name: 'Brief ready' });
    expect(readyStatus).toHaveTextContent('Your core brief is ready. Review it in the Brief tab.');
    expect(screen.getAllByText(/Your core brief is ready/i)).toHaveLength(1);

    act(() => resize(false));
    expect(screen.queryByRole('status', { name: 'Brief ready' })).toBeNull();
    expect(screen.queryByText(/tab on the right|rail on the right/i)).toBeNull();
  }, 15_000);

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
        retryable: false,
        crmQueued: true,
        crmRevision: 1,
        approvedDraftVersion: 1,
        approvalInputHash: 'approval-hash-v1',
        approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
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

  test('after a successful send, the rail renders queued public copy and follow-up actions', async () => {
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

    await waitFor(() => {
      const confirmation = document.querySelector('[data-testid="approve-confirmation"]');
      expect(confirmation).not.toBeNull();
      expect(screen.getByRole('button', { name: /book a catch-up/i })).toBeInTheDocument();
      expect(screen.getByText('Queued for the Balance team')).toBeInTheDocument();
      expect(screen.getByText('Was this clear?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(logEventMock).toHaveBeenCalledWith({
      sessionId: 'mock-session-id',
      eventName: 'trust_feedback',
      properties: { dimension: 'clarity_helpfulness', response: 'yes' }
    }));
    expect(screen.getByText('Thanks for the feedback.')).toHaveAttribute('role', 'status');

    expect(screen.getByTestId('approve-confirmation').textContent).not.toMatch(/crm|telegram|revision|reviewed/i);
  });

  test('when finalization persists without queue or delivery, the rail says Brief saved', async () => {
    mockWidgetFetch();
    finalizeLeadMock.mockResolvedValueOnce({
      ok: true,
      sessionId: 'mock-session-id',
      qualificationStatus: 'qualified',
      persisted: true,
      queued: false,
      delivered: false,
      retryable: false,
      crmQueued: false,
      crmRevision: 1,
      approvedDraftVersion: 1,
      approvalInputHash: 'approval-hash-v1',
      approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
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
      expect(screen.getByText('Brief saved')).toBeInTheDocument();
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
      retryable: false,
      crmQueued: false,
      crmRevision: 1,
      approvedDraftVersion: 1,
      approvalInputHash: 'approval-hash-v1',
      approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
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

  test('reloads and shows retryable error when server approval facts mismatch the submitted draft', async () => {
    let draftReloads = 0;
    mockWidgetFetch();
    const baseFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/projects/mock-session-id/draft') && init?.method !== 'PUT') {
        draftReloads += 1;
        return makeJsonResponse({
          sessionId: 'mock-session-id', draft: {}, draftVersion: 1, fieldCount: 0,
          referenceLinks: [], canonicalReferenceSetHash: 'current-reference-hash'
        });
      }
      return baseFetch(input, init);
    }) as unknown as typeof fetch;
    finalizeLeadMock.mockResolvedValueOnce({
      ok: true, sessionId: 'mock-session-id', qualificationStatus: 'qualified', persisted: true,
      queued: true, delivered: false, retryable: false, crmQueued: true, crmRevision: 2,
      approvedDraftVersion: 2, approvalInputHash: 'server-approval-hash',
      approvedReferenceSetHash: 'different-reference-hash'
    });
    render(<WidgetOverlay autoOpen={true} />);
    const input = await startAiConversation();
    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Send brief to Balance' }));

    expect(await screen.findByRole('alert', {}, { timeout: 7000 })).toHaveTextContent(/changed.*reload|reload.*retry/i);
    expect(document.querySelector('[data-testid="approve-confirmation"]')).toBeNull();
    expect(draftReloads).toBeGreaterThan(0);
  }, 15_000);

  test('shows one retryable approval error above both mobile tab panels', async () => {
    setMobileViewport(true);
    mockWidgetFetch();
    finalizeLeadMock
      .mockRejectedValueOnce(new Error('temporary finalization failure'))
      .mockResolvedValueOnce({
        ok: true, sessionId: 'mock-session-id', qualificationStatus: 'qualified', persisted: true,
        queued: true, delivered: false, retryable: false, crmQueued: true, crmRevision: 1, approvedDraftVersion: 1,
        approvalInputHash: 'approval-hash-v1', approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
      });
    render(<WidgetOverlay autoOpen={true} />);
    const input = await startAiConversation();
    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.click(await screen.findByRole('tab', { name: 'Brief' }));
    const mountedRail = screen.getByTestId('review-rail');
    fireEvent.click(await screen.findByRole('button', { name: 'Send brief to Balance' }));
    const alert = await screen.findByRole('alert', {}, { timeout: 7000 });
    expect(alert).toHaveTextContent('The brief was not sent');
    expect(alert.closest('[role="tabpanel"]')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry sending brief' });
    expect(retry).toHaveClass('balance-widget-action');
    expect(within(alert).getByRole('button', { name: 'Talk to the team without AI' })).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Email the team' })).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
    expect(within(alert).getByRole('button', { name: 'Book a call' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(alert).toBeVisible();
    fireEvent.click(retry);
    await waitFor(() => expect(finalizeLeadMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Queued for the Balance team')).toBeInTheDocument();
    expect(screen.queryByTestId('review-rail')).toBeNull();
    expect(mountedRail).not.toBeInTheDocument();
  }, 20_000);

  test('reports verified delivery instead of merely saved or queued', async () => {
    mockWidgetFetch();
    finalizeLeadMock.mockResolvedValueOnce({
      ok: true, sessionId: 'mock-session-id', qualificationStatus: 'qualified', persisted: true,
      queued: true, delivered: true, retryable: false, crmQueued: true, crmRevision: 1, approvedDraftVersion: 1,
      approvalInputHash: 'approval-hash-v1', approvedReferenceSetHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
    });
    render(<WidgetOverlay autoOpen={true} />);
    const input = await startAiConversation();
    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.click(await screen.findByRole('button', { name: 'Send brief to Balance' }));

    expect(await screen.findByText('Delivered to the Balance team')).toBeInTheDocument();
    expect(screen.queryByText('Brief saved')).toBeNull();
    expect(screen.queryByText('Queued for the Balance team')).toBeNull();
  }, 10_000);

  test('does not finalize until producer-transfer consent has been recorded', async () => {
    mockWidgetFetch();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        return makeJsonResponse({ sessionId: 'mock-session-id', capability: 'mock-session-id.mock-cap', expiresAt: new Date(Date.now() + 86400000).toISOString(), persisted: true });
      }
      if (url.includes('/api/chat')) {
        return makeJsonResponse({
          message: 'Ready.',
          draftUpdates: { service: 'production', projectType: 'Video', projectScope: '30s animation', timelineBand: '1-2-months', budgetBand: '20k-50k', contactName: 'Jayden', contactCompany: 'Acme', contactEmail: 'jayden@example.com' },
          outcome: 'draft_persisted',
          canonicalDraft: { service: 'production', projectType: 'Video', projectScope: '30s animation', timelineBand: '1-2-months', budgetBand: '20k-50k', contactName: 'Jayden', contactCompany: 'Acme', contactEmail: 'jayden@example.com' },
          draftVersion: 1,
          currentStage: 'project',
          stageRecaps: [],
          briefReady: true,
          missingFields: []
        });
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

    expect(await screen.findByText(/could not confirm consent/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(finalizeLeadMock).not.toHaveBeenCalled();
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
      expect(screen.getByRole('button', { name: /book a catch-up/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /book a catch-up/i }));

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
