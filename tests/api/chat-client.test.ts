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
      new Response(JSON.stringify({ outcome: 'non_persistence', message: 'Hello there.' }), {
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
          outcome: 'draft_persisted',
          messages: ['First.', 'Second.', 'Third.'],
          draftUpdates: { service: 'production' },
          canonicalDraft: { service: 'production' },
          draftVersion: 1,
          currentStage: 'project',
          stageRecaps: [],
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
      outcome: 'draft_persisted',
      message: 'Who is this for?',
      canonicalDraft: { projectScope: 'Canonical launch film', projectObjective: 'Build awareness' },
      canonicalProvenance: { projectScope: 'user-stated', projectObjective: 'inferred' },
      draftVersion: 6,
      currentStage: 'audience',
      stageRecaps: ['So far: Canonical launch film; objective: Build awareness.'],
      briefReady: false
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    await expect(chatRequest({ messages: [{ role: 'user', content: 'launch film' }] })).resolves.toEqual({
      replies: [{ text: 'Who is this for?' }],
      outcome: 'draft_persisted',
      canonicalDraft: { projectScope: 'Canonical launch film', projectObjective: 'Build awareness' },
      canonicalProvenance: { projectScope: 'user-stated', projectObjective: 'inferred' },
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
    if (result?.outcome !== 'draft_conflict') throw new Error('Expected a draft conflict');
    expect(result.canonicalDraft).toEqual({ projectScope: 'Winning draft' });
    expect(result.draftVersion).toBe(8);
  });

  test.each([
    ['persisted success', 200, { outcome: 'draft_persisted', message: 'Saved.', canonicalDraft: {}, draftVersion: 1, currentStage: 'project', stageRecaps: [] }],
    ['conflict', 409, { outcome: 'draft_conflict', message: 'Reloaded.', canonicalDraft: {}, draftVersion: 2, currentStage: 'project', stageRecaps: [] }]
  ])('rejects a malformed %s canonical tuple', async (_label, status, body) => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
      status: status as number,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const { chatRequest } = await import('@/lib/api/client');
    await expect(chatRequest({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toBeNull();
  });

  test('returns a stable typed save failure', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      message: 'I could not save that answer. Please try again, or talk to the team without AI.',
      outcome: 'draft_save_failed'
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    expect((await chatRequest({ messages: [{ role: 'user', content: 'my change' }] }))?.outcome).toBe('draft_save_failed');
  });

  test('rejects a non-persistence response without a displayable reply', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ outcome: 'non_persistence', message: '', messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    ) as unknown as typeof fetch;

    const { chatRequest } = await import('@/lib/api/client');
    const result = await chatRequest({
      messages: [{ role: 'user', content: 'no clue' }]
    });

    expect(result).toBeNull();
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
        outcome: 'provider_unavailable',
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
      outcome: 'confidential_diversion'
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
      return new Response(JSON.stringify({ outcome: 'non_persistence', message: 'Hello there.' }), {
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

  test.each([
    { draft: {}, draftVersion: '3', fieldCount: 0 },
    { draft: { projectScope: { value: 42, provenance: 'confirmed', updatedAt: '2026-07-17T00:00:00.000Z' } }, draftVersion: 3, fieldCount: 1 },
    { draft: {}, draftVersion: 3, fieldCount: 0, unexpected: true }
  ])('rejects a malformed project draft GET response %#', async (body) => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const { fetchProjectDraft } = await import('@/lib/api/client');

    await expect(fetchProjectDraft('session-123')).resolves.toBeNull();
  });

  test('preserves canonical field provenance and reference IDs from project draft responses', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      sessionId: 'session-123',
      draft: {
        projectScope: { value: 'My wording', provenance: 'user-stated', updatedAt: '2026-07-17T00:00:00.000Z' },
        scopePolished: { value: 'Generated summary', provenance: 'inferred', updatedAt: '2026-07-17T00:00:01.000Z' }
      },
      draftVersion: 3,
      fieldCount: 2,
      referenceLinks: [{ id: 'reference-1', url: 'https://vimeo.com/123', kind: 'vimeo' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    const { fetchProjectDraft } = await import('@/lib/api/client');

    await expect(fetchProjectDraft('session-123')).resolves.toMatchObject({
      draft: { projectScope: 'My wording', scopePolished: 'Generated summary' },
      provenance: { projectScope: 'user-stated', scopePolished: 'inferred' },
      referenceLinks: [{ id: 'reference-1', sessionId: 'session-123', url: 'https://vimeo.com/123', kind: 'vimeo' }]
    });
  });

  test.each([
    [200, { sessionId: 'session-123', draft: {}, fieldCount: 0 }],
    [409, { error: 'Draft version conflict.', draft: { projectScope: 'not-versioned' }, draftVersion: 4, fieldCount: 1 }]
  ])('rejects a malformed project draft update response with status %i', async (status, body) => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
      status: status as number, headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const { updateProjectDraft } = await import('@/lib/api/client');

    await expect(updateProjectDraft('session-123', [
      { field: 'projectScope', value: 'Launch film', provenance: 'confirmed' }
    ], 3)).resolves.toEqual({ ok: false, conflict: false });
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
        body: JSON.stringify({ scope: 'producer_transfer', granted: true, noticeVersion: '1.2' })
      })
    );
  });
});

describe('finalizeLead client', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('returns exact server approval facts for persisted success', async () => {
    const body = {
      ok: true, sessionId: 'session-123', qualificationStatus: 'qualified', persisted: true,
      queued: true, delivered: false, retryable: false, crmQueued: true, crmRevision: 2,
      approvedDraftVersion: 7, approvalInputHash: 'approval-hash', approvedReferenceSetHash: 'reference-hash'
    };
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const { finalizeLead } = await import('@/lib/api/client');

    await expect(finalizeLead({ sessionId: 'session-123' })).resolves.toEqual(body);
  });

  test.each(['approvedDraftVersion', 'approvalInputHash', 'approvedReferenceSetHash'] as const)(
    'rejects persisted success without server %s',
    async (missingField) => {
      const body: Record<string, unknown> = {
        ok: true, sessionId: 'session-123', qualificationStatus: 'qualified', persisted: true,
        approvedDraftVersion: 7, approvalInputHash: 'approval-hash', approvedReferenceSetHash: 'reference-hash'
      };
      delete body[missingField];
      global.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      })) as unknown as typeof fetch;
      const { finalizeLead } = await import('@/lib/api/client');

      await expect(finalizeLead({ sessionId: 'session-123' })).resolves.toBeNull();
    }
  );
});
