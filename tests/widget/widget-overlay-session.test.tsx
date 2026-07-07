// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { WidgetOverlay, SESSION_STORAGE_KEY } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;

class MemoryStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

function installLocalStorage() {
  const mem = new MemoryStorage();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: mem
  });
  return mem;
}

beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // no-op for jsdom
    };
  }
});

afterEach(() => {
  global.fetch = originalFetch;
});

type RecordedRequest = { url: string; method?: string };

function makeFetchRecorder(handlers: Array<(req: RecordedRequest) => Response | null>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const handler of handlers) {
      const r = handler({ url, method: init?.method });
      if (r) return r;
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

describe('WidgetOverlay session persistence in localStorage', () => {
  test('when localStorage has no sessionId, mounting the widget creates a new session and persists it', async () => {
    const mem = installLocalStorage();
    mem.clear();
    expect(mem.getItem(SESSION_STORAGE_KEY)).toBeNull();

    let sessionsRequested = 0;
    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions') && method === 'POST') {
          sessionsRequested += 1;
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

    await waitFor(() => {
      expect(mem.getItem(SESSION_STORAGE_KEY)).toBe('created-session-id');
    });
    expect(sessionsRequested).toBeGreaterThanOrEqual(1);
  });

  test('when localStorage has a valid sessionId, mounting the widget verifies it via /api/sessions/inspect and reuses it', async () => {
    const mem = installLocalStorage();
    mem.clear();
    mem.setItem(SESSION_STORAGE_KEY, 'stored-good-session');

    let sessionCreateCalls = 0;
    let sessionInspectCalls = 0;
    let inspectIds: string[] = [];

    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          sessionInspectCalls += 1;
          const u = new URL(url, 'http://localhost');
          const id = u.searchParams.get('id');
          if (id) inspectIds.push(id);
          return new Response(JSON.stringify({ exists: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
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

    await waitFor(() => {
      expect(sessionInspectCalls).toBeGreaterThanOrEqual(1);
    });

    expect(inspectIds[0]).toBe('stored-good-session');
    expect(sessionCreateCalls).toBe(0);
    expect(mem.getItem(SESSION_STORAGE_KEY)).toBe('stored-good-session');
  });

  test('when localStorage has an INVALID sessionId, the widget clears it and creates a new session', async () => {
    const mem = installLocalStorage();
    mem.clear();
    mem.setItem(SESSION_STORAGE_KEY, 'stale-bad-id');

    global.fetch = makeFetchRecorder([
      ({ url, method }) => {
        if (url.includes('/api/sessions/inspect')) {
          return new Response(JSON.stringify({ exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (url.includes('/api/sessions') && method === 'POST') {
          return new Response(JSON.stringify({ sessionId: 'brand-new-id', persisted: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return null;
      }
    ]);

    render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(mem.getItem(SESSION_STORAGE_KEY)).toBe('brand-new-id');
    });
  });

  test('localStorage contract: SESSION_STORAGE_KEY is exported and starts with the app namespace', () => {
    installLocalStorage();
    expect(typeof SESSION_STORAGE_KEY).toBe('string');
    expect(SESSION_STORAGE_KEY).toMatch(/^balance-assist:/);
  });
});
