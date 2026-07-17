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

  test('returns validated canonical saved progress', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      message: 'Who is this for?',
      canonicalDraft: { projectScope: 'Canonical launch film', projectObjective: 'Build awareness' },
      draftVersion: 6,
      currentStage: 'audience',
      stageRecaps: ['So far: Canonical launch film; objective: Build awareness.'],
      briefReady: false
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    await expect(chatRequest({ messages: [{ role: 'user', content: 'launch film' }] })).resolves.toEqual({
      replies: [{ text: 'Who is this for?' }],
      canonicalDraft: { projectScope: 'Canonical launch film', projectObjective: 'Build awareness' },
      draftVersion: 6,
      currentStage: 'audience',
      stageRecaps: ['So far: Canonical launch film; objective: Build awareness.'],
      briefReady: false,
      draftUpdates: {},
      sharedWork: null
    });
  });

  test('returns a typed conflict with the winning canonical draft', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      message: 'This brief changed elsewhere, so I reloaded the latest saved version. Please reapply your change.',
      outcome: 'draft_conflict',
      canonicalDraft: { projectScope: 'Winning draft' },
      draftVersion: 8,
      currentStage: 'project',
      stageRecaps: [],
      briefReady: false
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({ messages: [{ role: 'user', content: 'my change' }] });
    expect(result?.outcome).toBe('draft_conflict');
    expect(result?.canonicalDraft).toEqual({ projectScope: 'Winning draft' });
    expect(result?.draftVersion).toBe(8);
  });

  test('returns a stable typed save failure', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      message: 'I could not save that answer. Please try again, or talk to the team without AI.',
      outcome: 'draft_save_failed'
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    expect((await chatRequest({ messages: [{ role: 'user', content: 'my change' }] }))?.outcome).toBe('draft_save_failed');
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

  test('preserves the exact provider-unavailable 503 as a typed chat response', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        error: 'Chat service unavailable',
        detail: 'chat_provider_unavailable'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    ) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({
      messages: [{ role: 'user', content: 'provider-dependent request' }]
    });

    expect(result).toEqual({
      outcome: 'provider_unavailable',
      error: 'Chat service unavailable',
      detail: 'chat_provider_unavailable',
      replies: [],
      draftUpdates: {},
      briefReady: false,
      sharedWork: null
    });
  });

  test('rejects malformed reply text before it reaches the widget', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ messages: ['valid', 42], draftUpdates: {}, briefReady: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    await expect(chatRequest({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toBeNull();
  });

  test('returns the validated confidential diversion outcome', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      message: 'This channel cannot process confidential or sensitive material. Please use the human-only path to talk to the Balance team.',
      outcome: 'confidential_diversion',
      draftUpdates: {},
      briefReady: false
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({ messages: [{ role: 'user', content: 'protected text' }] });

    expect(result?.outcome).toBe('confidential_diversion');
  });

  test('rejects an unknown chat outcome', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      message: 'Unexpected response',
      outcome: 'retry_with_history'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
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
    expect(form.get('mode')).toBe('human');
    expect(form.get('consent')).toBeNull();
    expect(form.get('sessionId')).toBeNull();
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).toEqual({
      'x-session-id': 'session-123',
      'x-upload-mode': 'human'
    });
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
        body: JSON.stringify({ scope: 'producer_transfer', granted: true, noticeVersion: '1.1' })
      })
    );
  });
});
