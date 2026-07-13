// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WidgetOverlay } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;
const originalReferrer = document.referrer;

beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // no-op for jsdom
    };
  }
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

async function acknowledgeNotice() {
  fireEvent.click(await screen.findByTestId('consent-button'));
}

async function startWithBalanceAssist() {
  await acknowledgeNotice();
  fireEvent.click(await screen.findByRole('button', { name: /start with balance assist/i }));
}

async function findChatInput() {
  return waitFor(() => {
    const input = document.querySelector('input[placeholder]') as HTMLInputElement | null;
    if (!input) {
      throw new Error('chat input not yet rendered');
    }
    return input;
  });
}

async function chooseHumanPath() {
  await acknowledgeNotice();
  fireEvent.click(await screen.findByRole('button', { name: /talk to a human/i }));
}

describe('WidgetOverlay consent-led session bootstrap', () => {
  test('does not create a session before the user acknowledges the data-use notice', async () => {
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

  test('creates a session only after consent/start and strips query strings, fragments, and detailed referrer data', async () => {
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

    fireEvent.click(screen.getByTestId('brief-row-edit-contactName'));
    const editor = await screen.findByDisplayValue('Taylor');
    fireEvent.change(editor, { target: { value: 'Jordan' } });
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', charCode: 13 });

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

  test('creates a session only after notice acknowledgement when the user chooses the human path', async () => {
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
            message: 'We recorded your deletion request. Downstream copies are handled separately.'
          }), {
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
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
    }, { timeout: 7000 });

    const input = await findChatInput();
    fireEvent.change(input, { target: { value: 'delete this project' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(requestLog.some((entry) => entry.url.includes('/api/projects/delete-session-id/delete') && entry.method === 'POST')).toBe(true);
      expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/recorded your deletion request/i);
    });
  });
});
