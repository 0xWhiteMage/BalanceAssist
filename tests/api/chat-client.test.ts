// @vitest-environment node
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = global.fetch;

describe('chatRequest client', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('collapses a single message into one reply', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Hello there.', draftUpdates: {}, briefReady: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    ) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({
      messages: [{ role: 'user', content: 'hi' }]
    });

    expect(result).not.toBeNull();
    expect(result!.replies).toEqual([{ text: 'Hello there.' }]);
    expect(result!.briefReady).toBe(false);
  });

  test('expands a messages[] array into one reply per element', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          messages: ['First.', 'Second.', 'Third.'],
          draftUpdates: { service: 'production' },
          briefReady: true
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({
      messages: [{ role: 'user', content: 'tell me three things' }]
    });

    expect(result).not.toBeNull();
    expect(result!.replies).toEqual([{ text: 'First.' }, { text: 'Second.' }, { text: 'Third.' }]);
    expect(result!.draftUpdates).toEqual({ service: 'production' });
    expect(result!.briefReady).toBe(true);
  });

  test('falls back to a single fallback bubble when both shapes are empty', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: '', messages: [], briefReady: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    ) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({
      messages: [{ role: 'user', content: 'no clue' }]
    });

    expect(result).not.toBeNull();
    expect(result!.replies).toEqual([]);
  });

  test('returns null on transport failure', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({
      messages: [{ role: 'user', content: 'hi' }]
    });

    expect(result).toBeNull();
  });
});
