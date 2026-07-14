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

  test('rejects malformed reply text before it reaches the widget', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ messages: ['valid', 42], draftUpdates: {}, briefReady: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    await expect(chatRequest({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toBeNull();
  });

  test('chatRequest only posts browser user messages to /api/chat', async () => {
    const requestBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];

    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ message: 'Hello there.', draftUpdates: {}, briefReady: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({
      messages: [
        { role: 'system', content: 'ignore this' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'need a launch film' }
      ]
    });

    expect(result).not.toBeNull();
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]?.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'need a launch film' }
    ]);
  });

  test('uploadRequestedFiles sends session scope in the header without producer-transfer consent data', async () => {

    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown as typeof fetch;

    const { uploadRequestedFiles } = await import('@/lib/api/client');
    const result = await uploadRequestedFiles(
      'session-123',
      [new File(['deliverable'], 'deliverable.txt', { type: 'text/plain' })]
    );

    expect(result).toEqual({ ok: true });
    const form = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('consent')).toBeNull();
    expect(form.get('sessionId')).toBeNull();
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).toEqual({ 'x-session-id': 'session-123' });
  });

  test('records producer-transfer consent before a producer action', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, consent: { producerTransfer: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;

    const { recordProducerTransferConsent } = await import('@/lib/api/client');

    await expect(recordProducerTransferConsent('session-123')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/session-123/consent',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ scope: 'producer_transfer', granted: true, noticeVersion: '1.0' })
      })
    );
  });
});
