// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WidgetOverlay } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;
const originalReferrer = document.referrer;
const deletionReceiptStorageKey = 'balance-assist-deletion-receipt';

beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // no-op for jsdom
    };
  }
});

beforeEach(() => {
  window.localStorage?.removeItem?.(deletionReceiptStorageKey);
});

afterEach(() => {
  global.fetch = originalFetch;
  Object.defineProperty(document, 'referrer', { configurable: true, value: originalReferrer });
  window.history.replaceState({}, '', '/');
});

type RecordedRequest = { url: string; method?: string; body?: unknown };

function makeFetchRecorder(handlers: Array<(req: RecordedRequest) => Response | null>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    for (const handler of handlers) {
      const response = handler({ url, method: init?.method, body });
      if (response) return response;
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function continueWithAi() {
  fireEvent.click(await screen.findByRole('button', { name: 'Build a brief with AI' }));
}

async function startWithBalanceAssist() {
  await continueWithAi();
}

async function findChatInput() {
  return waitFor(() => {
    const input = document.querySelector('textarea[placeholder]') as HTMLTextAreaElement | null;
    if (!input) {
      throw new Error('chat input not yet rendered');
    }
    return input;
  });
}

async function chooseHumanPath() {
  fireEvent.click(await screen.findByRole('button', { name: 'Talk to the team without AI' }));
}

describe('WidgetOverlay consent-led session bootstrap', () => {
  test('does not create a session before the user chooses a path', async () => {
    const requestLog: RecordedRequest[] = [];

    global.fetch = makeFetchRecorder([
      ({ url, method, body }) => {
        requestLog.push({ url, method, body });
        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await screen.findByTestId('data-use-notice');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requestLog.some((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toBe(false);
    expect(requestLog.some((entry) => entry.url.includes('/api/sessions/inspect'))).toBe(false);
  });

  test('creates a session only after the informed AI choice and strips query strings, fragments, and detailed referrer data', async () => {
    const requestLog: RecordedRequest[] = [];
    window.history.replaceState({}, '', '/projects/launch-film?utm_source=ads#brief');
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://partner.example/ref/path?campaign=hidden#fragment'
    });

    global.fetch = makeFetchRecorder([
      ({ url, method, body }) => {
        requestLog.push({ url, method, body });

        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'created-session-id', persisted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/events')) {
          return new Response('{}', { status: 200 });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    await waitFor(() => {
      expect(requestLog.some((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toBe(true);
    });

    const createRequest = requestLog.find((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST');
    expect(createRequest?.body).toMatchObject({
      sourceUrl: `${window.location.origin}/projects/launch-film`,
      referrer: 'https://partner.example',
      consentVersion: expect.any(String),
      consentedAt: expect.any(String)
    });
    expect((createRequest?.body as { sourceUrl?: string }).sourceUrl).not.toContain('?');
    expect((createRequest?.body as { sourceUrl?: string }).sourceUrl).not.toContain('#');
  });

  test('reuses the current session after consent/start without creating a new one', async () => {
    let sessionCreateCalls = 0;
    const inspectUrls: string[] = [];

    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          inspectUrls.push(url);
          return new Response(
            JSON.stringify({
              ok: true,
              exists: true,
              session: {
                id: 'stored-good-session',
                status: 'open',
                source_url: 'https://www.balancestudio.tv'
              }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          sessionCreateCalls += 1;
          return new Response(JSON.stringify({ sessionId: 'fresh-session', persisted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    await waitFor(() => {
      expect(inspectUrls.length).toBeGreaterThanOrEqual(1);
    });

    expect(inspectUrls[0]).toContain('/api/sessions/inspect');
    expect(inspectUrls[0]).not.toContain('?id=');
    expect(sessionCreateCalls).toBe(0);
  });

  test('loads the canonical draft when an existing session is reused', async () => {
    const requestLog: RecordedRequest[] = [];

    global.fetch = makeFetchRecorder([
      ({ url, method, body }) => {
        requestLog.push({ url, method, body });

        if (url.includes('/api/sessions/inspect')) {
          return new Response(
            JSON.stringify({
              ok: true,
              exists: true,
              session: {
                id: 'stored-good-session',
                status: 'open',
                source_url: 'https://www.balancestudio.tv'
              }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.includes('/api/projects/stored-good-session/draft') && !method) {
          return new Response(
            JSON.stringify({
              sessionId: 'stored-good-session',
              draftVersion: 4,
              fieldCount: 3,
              draft: {
                service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                projectScope: { value: 'Launch film', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                contactName: { value: 'Taylor', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' }
              }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    await waitFor(() => {
      expect(requestLog.some((entry) => entry.url.includes('/api/projects/stored-good-session/draft'))).toBe(true);
      expect(screen.queryByTestId('review-rail')).not.toBeNull();
      expect(screen.getByRole('log')).toHaveTextContent(/Welcome back.*What should this project achieve\?/i);
      expect(screen.getByRole('log')).not.toHaveTextContent(/What can I help you with today\?/i);
    });
  });

  test('persists review edits through the canonical draft route with the expected draft version', async () => {
    const requestLog: RecordedRequest[] = [];

    global.fetch = makeFetchRecorder([
      ({ url, method, body }) => {
        requestLog.push({ url, method, body });

        if (url.includes('/api/sessions/inspect')) {
          return new Response(
            JSON.stringify({
              ok: true,
              exists: true,
              session: {
                id: 'stored-good-session',
                status: 'open',
                source_url: 'https://www.balancestudio.tv'
              }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.includes('/api/projects/stored-good-session/draft') && !method) {
          return new Response(
            JSON.stringify({
              sessionId: 'stored-good-session',
              draftVersion: 4,
              fieldCount: 3,
              draft: {
                service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                projectScope: { value: 'Launch film', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                contactName: { value: 'Taylor', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' }
              }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.includes('/api/projects/stored-good-session/draft') && method === 'PUT') {
          return new Response(
            JSON.stringify({
              sessionId: 'stored-good-session',
              draftVersion: 5,
              fieldCount: 3,
              draft: {
                service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                projectScope: { value: 'Launch film', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                contactName: { value: 'Jordan', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' }
              }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    await waitFor(() => {
      expect(screen.queryByTestId('review-rail')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Brief' }));
    fireEvent.click(screen.getByTestId('brief-row-edit-contactName'));
    const editor = await screen.findByDisplayValue('Taylor');
    fireEvent.change(editor, { target: { value: 'Jordan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact name' }));

    await waitFor(() => {
      const updateRequest = requestLog.find(
        (entry) => entry.url.includes('/api/projects/stored-good-session/draft') && entry.method === 'PUT'
      );
      expect(updateRequest).toBeDefined();
      expect(updateRequest?.body).toMatchObject({
        expectedDraftVersion: 4,
        fields: [{ field: 'contactName', value: 'Jordan', provenance: 'confirmed' }]
      });
    });
  });

  test('creates a human relay session with human-contact consent but without AI or producer-transfer consent', async () => {
    const requestLog: RecordedRequest[] = [];

    global.fetch = makeFetchRecorder([
      ({ url, method, body }) => {
        requestLog.push({ url, method, body });

        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'human-session-id', persisted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/events')) {
          return new Response('{}', { status: 200 });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await chooseHumanPath();

    await waitFor(() => {
      expect(requestLog.some((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toBe(true);
    });
    expect(requestLog.some((entry) => entry.url.includes('/api/chat'))).toBe(false);
    const consentRequest = requestLog.find((entry) => entry.url.includes('/consent'));
    expect(consentRequest?.body).toMatchObject({ scope: 'human_contact', granted: true });
    expect(JSON.stringify(consentRequest?.body)).not.toContain('producer_transfer');
    expect(screen.queryByRole('button', { name: 'Attach references' })).toBeNull();
  });

  test('does not continue a human bootstrap after the widget closes', async () => {
    const requestLog: RecordedRequest[] = [];
    const pendingSession = deferred<Response>();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      requestLog.push({ url, method: init?.method, body });
      if (url.includes('/api/sessions/inspect')) {
        return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      }
      if (url.includes('/api/sessions') && init?.method === 'POST') return pendingSession.promise;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    await chooseHumanPath();
    await waitFor(() => expect(requestLog.some((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toBe(true));
    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    await act(async () => {
      pendingSession.resolve(new Response(JSON.stringify({ sessionId: 'late-session', persisted: true }), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(requestLog.some((entry) => entry.url.includes('/consent'))).toBe(false);
    expect(requestLog.some((entry) => entry.url.includes('/api/events'))).toBe(false);
    expect(requestLog.some((entry) => /\/api\/(chat|telegram\/relay|telegram\/messages)/.test(entry.url))).toBe(false);
  });

  test('invalidates a pending AI create on close and starts one fresh bootstrap on reopen', async () => {
    const pendingCreate = deferred<Response>();
    let createCalls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sessions/inspect')) {
        return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      }
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        createCalls += 1;
        if (createCalls === 1) return pendingCreate.promise;
        return new Response(JSON.stringify({ sessionId: 'fresh-ai-session', persisted: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();
    await waitFor(() => expect(createCalls).toBe(1));
    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    fireEvent.click(screen.getByLabelText('Open Balance Assist'));
    await waitFor(() => expect(createCalls).toBe(2));
    await act(async () => {
      pendingCreate.resolve(new Response(JSON.stringify({ sessionId: 'stale-ai-session', persisted: true }), { status: 200 }));
    });

    await waitFor(() => {
      expect(screen.getAllByText(/What can I help you with today\?/i)).toHaveLength(1);
    }, { timeout: 7_000 });
    expect(createCalls).toBe(2);
  }, 10_000);

  test('enables AI interaction while pacing the intro messages', async () => {
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
        }
        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'ready-ai-session', persisted: true }), { status: 200 });
        }
        return null;
      }
    ]);
    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    expect(await findChatInput()).toBeEnabled();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i })).toHaveTextContent(/What can I help you with today\?/i);
      expect(screen.queryByRole('status', { name: 'Balance Assist is typing' })).toBeNull();
    }, { timeout: 3_000 });
  });

  test('invalidates a pending AI restore on close and restarts cleanly on reopen', async () => {
    const pendingRestore = deferred<Response>();
    let inspectCalls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sessions/inspect')) {
        inspectCalls += 1;
        if (inspectCalls === 1) return pendingRestore.promise;
        return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      }
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'fresh-restored-ai-session', persisted: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();
    await waitFor(() => expect(inspectCalls).toBe(1));
    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    fireEvent.click(screen.getByLabelText('Open Balance Assist'));
    await waitFor(() => expect(inspectCalls).toBe(2));
    await act(async () => {
      pendingRestore.resolve(new Response(JSON.stringify({
        ok: true,
        exists: true,
        session: { id: 'stale-restored-ai-session', status: 'open', source_url: '' }
      }), { status: 200 }));
    });

    await waitFor(() => {
      expect(screen.getAllByText(/What can I help you with today\?/i)).toHaveLength(1);
    }, { timeout: 7_000 });
    expect(inspectCalls).toBe(2);
  }, 10_000);

  test.each([
    ['missing', { ok: true, exists: false }],
    ['restored', { ok: true, exists: true, session: { id: 'unmounted-restored-ai', status: 'open', source_url: '' } }]
  ])('does not continue a pending %s AI restore after unmount', async (_case, inspectBody) => {
    const pendingRestore = deferred<Response>();
    const requestLog: RecordedRequest[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestLog.push({ url, method: init?.method });
      if (url.includes('/api/sessions/inspect')) return pendingRestore.promise;
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'should-not-create', persisted: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { unmount } = render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();
    await waitFor(() => expect(requestLog.some((entry) => entry.url.includes('/api/sessions/inspect'))).toBe(true));
    unmount();
    pendingRestore.resolve(new Response(JSON.stringify(inspectBody), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requestLog.some((entry) => entry.url === '/api/sessions' && entry.method === 'POST')).toBe(false);
    expect(requestLog.some((entry) => entry.url.includes('/api/projects/unmounted-restored-ai'))).toBe(false);
  });

  test('does not revive a stale human bootstrap when reopened before it resolves', async () => {
    const requestLog: RecordedRequest[] = [];
    const pendingSession = deferred<Response>();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      requestLog.push({ url, method: init?.method, body });
      if (url.includes('/api/sessions/inspect')) {
        return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      }
      if (url.includes('/api/sessions') && init?.method === 'POST') return pendingSession.promise;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} calendlyUrlOverride="https://calendly.com/balance/test" />);

    await chooseHumanPath();
    await waitFor(() => expect(requestLog.some((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toBe(true));
    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    fireEvent.click(screen.getByLabelText('Open Balance Assist'));
    await act(async () => {
      pendingSession.resolve(new Response(JSON.stringify({ sessionId: 'late-reopened-session', persisted: true }), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.queryByPlaceholderText(/message the team request|type a message/i)).toBeNull();
    expect(screen.getByRole('link', { name: /email us/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /schedule a call/i })).toBeVisible();
    expect(requestLog.some((entry) => entry.url.includes('/consent'))).toBe(false);
    expect(requestLog.some((entry) => entry.url.includes('/api/events'))).toBe(false);
    expect(requestLog.some((entry) => /\/api\/(chat|telegram\/relay|telegram\/messages)/.test(entry.url))).toBe(false);
  });

  test('does not activate the relay when the widget closes during consent persistence', async () => {
    const requestLog: RecordedRequest[] = [];
    const pendingConsent = deferred<Response>();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      requestLog.push({ url, method: init?.method, body });
      if (url.includes('/api/sessions/inspect')) {
        return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      }
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'consent-session', persisted: true }), { status: 200 });
      }
      if (url.includes('/consent')) return pendingConsent.promise;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} calendlyUrlOverride="https://calendly.com/balance/test" />);

    await chooseHumanPath();
    await waitFor(() => expect(requestLog.some((entry) => entry.url.includes('/consent'))).toBe(true));
    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    await act(async () => {
      pendingConsent.resolve(new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    fireEvent.click(screen.getByLabelText('Open Balance Assist'));

    expect(screen.queryByPlaceholderText(/message the team request|type a message/i)).toBeNull();
    expect(requestLog.some((entry) => entry.url.includes('/api/events') && (entry.body as { eventName?: string })?.eventName === 'human_handoff')).toBe(false);
    expect(requestLog.some((entry) => /\/api\/(chat|telegram\/relay|telegram\/messages)/.test(entry.url))).toBe(false);
  });

  test('does not continue a pending human session create after unmount', async () => {
    const requestLog: RecordedRequest[] = [];
    const pendingSession = deferred<Response>();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestLog.push({ url, method: init?.method });
      if (url.includes('/api/sessions/inspect')) return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      if (url.includes('/api/sessions') && init?.method === 'POST') return pendingSession.promise;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { unmount } = render(<WidgetOverlay autoOpen={true} />);

    await chooseHumanPath();
    await waitFor(() => expect(requestLog.some((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toBe(true));
    unmount();
    pendingSession.resolve(new Response(JSON.stringify({ sessionId: 'unmounted-session', persisted: true }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requestLog.some((entry) => entry.url.includes('/consent'))).toBe(false);
    expect(requestLog.some((entry) => /\/api\/(events|chat|telegram\/relay|telegram\/messages)/.test(entry.url))).toBe(false);
  });

  test('does not continue pending human consent after unmount', async () => {
    const requestLog: RecordedRequest[] = [];
    const pendingConsent = deferred<Response>();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      requestLog.push({ url, method: init?.method, body });
      if (url.includes('/api/sessions/inspect')) return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'unmounted-consent-session', persisted: true }), { status: 200 });
      }
      if (url.includes('/consent')) return pendingConsent.promise;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { unmount } = render(<WidgetOverlay autoOpen={true} />);

    await chooseHumanPath();
    await waitFor(() => expect(requestLog.some((entry) => entry.url.includes('/consent'))).toBe(true));
    unmount();
    pendingConsent.resolve(new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requestLog.some((entry) => entry.url.includes('/api/events'))).toBe(false);
    expect(requestLog.some((entry) => /\/api\/(chat|telegram\/relay|telegram\/messages)/.test(entry.url))).toBe(false);
  });

  test('does not duplicate immediate consent-failure output after close and reopen', async () => {
    const requestLog: RecordedRequest[] = [];
    global.fetch = makeFetchRecorder([
      ({ url, method, body }) => {
        requestLog.push({ url, method, body });
        if (url.includes('/api/sessions/inspect')) return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'ai-session', persisted: true }), { status: 200 });
        }
        if (url.includes('/consent')) return new Response(JSON.stringify({ ok: false }), { status: 503 });
        return null;
      }
    ]);
    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
    }, { timeout: 7000 });
    fireEvent.click(screen.getByRole('button', { name: 'Message the team without AI' }));
    await waitFor(() => expect(requestLog.some((entry) => entry.url.includes('/consent'))).toBe(true));
    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    fireEvent.click(screen.getByLabelText('Open Balance Assist'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getAllByText('We could not save your permission to send a message to the Balance team. Please try again or use the contact options below.')).toHaveLength(1);
    expect(screen.queryByPlaceholderText(/message the team request/i)).toBeNull();
    expect(requestLog.some((entry) => /\/api\/(telegram\/relay|telegram\/messages)/.test(entry.url))).toBe(false);
  }, 10_000);

  test('coalesces repeated human activation into one bootstrap and continuation', async () => {
    const requestLog: RecordedRequest[] = [];
    const pendingSession = deferred<Response>();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      requestLog.push({ url, method: init?.method, body });
      if (url.includes('/api/sessions/inspect')) return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      if (url.includes('/api/sessions') && init?.method === 'POST') return pendingSession.promise;
      if (url.includes('/consent')) {
        return new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 });
      }
      if (url.includes('/api/events')) return new Response('{}', { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    const humanControl = await screen.findByRole('button', { name: 'Talk to the team without AI' });
    fireEvent.click(humanControl);
    fireEvent.click(humanControl);
    await waitFor(() => expect(requestLog.filter((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toHaveLength(1));
    await act(async () => {
      pendingSession.resolve(new Response(JSON.stringify({ sessionId: 'coalesced-session', persisted: true }), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(requestLog.filter((entry) => entry.url.includes('/api/sessions/inspect'))).toHaveLength(1);
    expect(requestLog.filter((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toHaveLength(1);
    expect(requestLog.filter((entry) => entry.url.includes('/consent'))).toHaveLength(1);
    expect(requestLog.filter((entry) => entry.url.includes('/api/events') && (entry.body as { eventName?: string })?.eventName === 'human_handoff')).toHaveLength(1);
  }, 10_000);

  test('allows a fresh generation while stale cleanup cannot unlock its in-flight guard', async () => {
    const requestLog: RecordedRequest[] = [];
    const staleConsent = deferred<Response>();
    const freshConsent = deferred<Response>();
    let consentCalls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      requestLog.push({ url, method: init?.method, body });
      if (url.includes('/api/sessions/inspect')) return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'generation-session', persisted: true }), { status: 200 });
      }
      if (url.includes('/consent')) {
        consentCalls += 1;
        return consentCalls === 1 ? staleConsent.promise : freshConsent.promise;
      }
      if (url.includes('/api/events')) return new Response('{}', { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
    }, { timeout: 7000 });
    fireEvent.click(screen.getByRole('button', { name: 'Message the team without AI' }));
    await waitFor(() => expect(consentCalls).toBe(1));
    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    fireEvent.click(screen.getByLabelText('Open Balance Assist'));
    fireEvent.click(screen.getByRole('button', { name: 'Message the team without AI' }));
    await waitFor(() => expect(consentCalls).toBe(2));

    await act(async () => {
      staleConsent.resolve(new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Message the team without AI' }));
    expect(consentCalls).toBe(2);

    await act(async () => {
      freshConsent.resolve(new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(requestLog.filter((entry) => entry.url.includes('/api/events') && (entry.body as { eventName?: string })?.eventName === 'human_handoff')).toHaveLength(1);
    expect(screen.getAllByPlaceholderText(/message the team request/i)).toHaveLength(1);
  }, 10_000);

  test('keeps human recovery persistent when human session creation fails', async () => {
    const requestLog: RecordedRequest[] = [];
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        requestLog.push({ url, method });
        if (url.includes('/api/sessions/inspect')) return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
        if (url.includes('/api/sessions') && method === 'POST') return new Response(JSON.stringify({ ok: false }), { status: 503 });
        return null;
      }
    ]);
    render(<WidgetOverlay autoOpen={true} calendlyUrlOverride="https://calendly.com/balance/test" />);

    await chooseHumanPath();
    const unavailable = await screen.findByText('The human-only relay could not start. You can still contact the team directly.');
    const email = screen.getByRole('link', { name: /email us/i });
    const booking = screen.getByRole('link', { name: /schedule a call/i });
    expect(unavailable).toBeVisible();
    expect(email).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
    expect(booking).toHaveAttribute('href', 'https://calendly.com/balance/test');
    expect(screen.queryByPlaceholderText(/message the team request|type a message/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Build a brief with AI' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Talk to the team without AI' })).toBeNull();

    email.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(email);
    expect(booking).toBeVisible();
    expect(unavailable).toBeVisible();

    booking.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(booking);
    expect(email).toBeVisible();
    expect(unavailable).toBeVisible();

    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    fireEvent.click(screen.getByLabelText('Open Balance Assist'));
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(screen.getByRole('link', { name: /email us/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /schedule a call/i })).toBeVisible();
    expect(screen.getByText('The human-only relay could not start. You can still contact the team directly.')).toBeVisible();
    expect(requestLog.filter((entry) => entry.url.includes('/api/sessions') && entry.method === 'POST')).toHaveLength(1);
    expect(requestLog.some((entry) => /\/api\/(chat|telegram\/relay|telegram\/messages)/.test(entry.url))).toBe(false);
  });

  test('keeps the intake choices available when session persistence fails', async () => {
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ ok: false, code: 'session_unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Build a brief with AI' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Talk to the team without AI' })).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText(/type a message/i)).toBeNull();
  });

  test('does not enter chat from an explicitly non-persisted session response', async () => {
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'ephemeral-session', persisted: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Build a brief with AI' })).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText(/type a message/i)).toBeNull();
  });

  test('does not enter chat from a session response with omitted persistence status', async () => {
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'unknown-persistence-session' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Build a brief with AI' })).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText(/type a message/i)).toBeNull();
  });

  test('starts only the selected AI path', async () => {
    let sessionCreateCalls = 0;
    const inspectResolvers: Array<(response: Response) => void> = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/sessions/inspect')) {
        return new Promise<Response>((resolve) => inspectResolvers.push(resolve));
      }

      if (url.includes('/api/sessions') && init?.method === 'POST') {
        sessionCreateCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({ sessionId: 'shared-session', persisted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }

      if (url.includes('/api/events')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }

      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Build a brief with AI' }));

    await waitFor(() => expect(inspectResolvers).toHaveLength(1));
    await act(async () => {
      const resolve = inspectResolvers[0];
      resolve(new Response(JSON.stringify({ ok: true, exists: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    });
    await waitFor(() => expect(sessionCreateCalls).toBe(1));
  });

  test('intro copy does not invite job applications or CV capture after the notice gate', async () => {
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'intro-session-id', persisted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
    }, { timeout: 7000 });

    expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).not.toMatch(/job application|cv|resume/i);
  });

  test('does not claim project memory was cleared when the server reset fails', async () => {
    const requestLog: RecordedRequest[] = [];

    global.fetch = makeFetchRecorder([
      ({ url, method, body }) => {
        requestLog.push({ url, method, body });

        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'reset-session-id', persisted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/projects/reset-session-id/reset') && method === 'POST') {
          return new Response(JSON.stringify({ ok: false, error: 'reset failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/events')) {
          return new Response('{}', { status: 200 });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
    }, { timeout: 7000 });

    const input = await findChatInput();
    fireEvent.change(input, { target: { value: 'forget this project' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(requestLog.some((entry) => entry.url.includes('/api/projects/reset-session-id/reset') && entry.method === 'POST')).toBe(true);
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).not.toMatch(/cleared my memory/i);
    });
  });

  test('clears only the editable brief and keeps the active session after a successful reset', async () => {
    let sessionCreates = 0;
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
        if (url.includes('/api/sessions') && method === 'POST') {
          sessionCreates += 1;
          return new Response(JSON.stringify({ sessionId: `reset-session-${sessionCreates}`, persisted: true }), { status: 200 });
        }
        if (url.includes('/api/projects/reset-session-1/reset') && method === 'POST') {
          return new Response(JSON.stringify({ ok: true, reset: true, draftVersion: 1 }), { status: 200 });
        }
        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);
    await startWithBalanceAssist();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
    }, { timeout: 7000 });

    const input = await findChatInput();
    fireEvent.change(input, { target: { value: 'forget this project' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/uploads, links, consent history/i);
    }, { timeout: 7000 });
    expect(sessionCreates).toBe(1);
  }, 15000);

  test('submits a deletion request through the server when the user asks to delete the project', async () => {
    const requestLog: RecordedRequest[] = [];

    global.fetch = makeFetchRecorder([
      ({ url, method, body }) => {
        requestLog.push({ url, method, body });

        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'delete-session-id', persisted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/projects/delete-session-id/delete') && method === 'POST') {
          return new Response(JSON.stringify({
            ok: true,
            receipt: '11111111-1111-4111-8111-111111111111.secret',
            receiptId: '11111111-1111-4111-8111-111111111111',
            status: 'requested',
            message: 'We recorded your deletion request. Downstream copies are handled separately.'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/api/deletions/status') && method === 'POST') {
          return new Response(JSON.stringify({
            ok: true,
            receiptId: '11111111-1111-4111-8111-111111111111',
            status: 'processing'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (url.includes('/api/events')) {
          return new Response('{}', { status: 200 });
        }

        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await startWithBalanceAssist();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
    }, { timeout: 7000 });

    const input = await findChatInput();
    fireEvent.change(input, { target: { value: 'delete this project' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/reply DELETE exactly/i), { timeout: 7000 });
    fireEvent.change(input, { target: { value: 'DELETE' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(requestLog.some((entry) => entry.url.includes('/api/projects/delete-session-id/delete') && entry.method === 'POST')).toBe(true);
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/recorded your deletion request/i);
      expect(screen.getByTestId('deletion-status').textContent).toMatch(/processing|requested/i);
      expect(screen.getByPlaceholderText('This session is frozen')).toBeDisabled();
    });
  }, 10000);

  test('does not schedule a client reset after clearing the editable brief', async () => {
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'reset-session-id', persisted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (url.includes('/api/projects/reset-session-id/reset') && method === 'POST') {
          return new Response(JSON.stringify({ ok: true, reset: true, draftVersion: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return null;
      }
    ]);

    const { unmount } = render(<WidgetOverlay autoOpen={true} />);
    await startWithBalanceAssist();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
    }, { timeout: 7000 });
    const input = await findChatInput();
    await waitFor(() => expect(input).not.toBeDisabled(), { timeout: 7000 });
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    try {
      fireEvent.change(input, { target: { value: 'forget this project' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(850);
      });
      const resetTimer = setTimeoutSpy.mock.results
        .map((result, index) => ({ timer: result.value, delay: setTimeoutSpy.mock.calls[index]?.[1] }))
        .find(({ delay }) => delay === 200)?.timer;
      expect(resetTimer).toBeUndefined();

      unmount();
      expect(clearTimeoutSpy).not.toHaveBeenCalledWith(resetTimer);
    } finally {
      vi.useRealTimers();
      clearTimeoutSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    }
  }, 10000);
});
