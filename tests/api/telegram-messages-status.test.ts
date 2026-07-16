// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));
vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));

type PersistedRead = { data: unknown; error: unknown };

const teamReply = {
  id: 17,
  sender: 'team',
  text: 'Avery: We can help.',
  created_at: '2026-07-17T10:00:00.000Z'
};

const queuedPollFixture = {
  outgoingStatus: 'queued' as const,
  fileRequestOpen: false,
  fileRequestNote: null,
  scheduleRequestOpen: false,
  messages: [{
    id: 17,
    sender: 'team' as const,
    text: 'Avery: We can help.',
    createdAt: '2026-07-17T10:00:00.000Z'
  }]
};

function buildSupabase({
  messages = { data: [teamReply], error: null },
  session = { data: null, error: null },
  outbox = { data: { state: 'pending', payload: { type: 'relay' } }, error: null }
}: {
  messages?: PersistedRead;
  session?: PersistedRead;
  outbox?: PersistedRead;
} = {}) {
  const messageQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    gt: vi.fn(),
    then: vi.fn((resolve: (value: PersistedRead) => unknown) => Promise.resolve(messages).then(resolve))
  };
  messageQuery.select.mockReturnValue(messageQuery);
  messageQuery.eq.mockReturnValue(messageQuery);
  messageQuery.order.mockReturnValue(messageQuery);
  messageQuery.limit.mockReturnValue(messageQuery);
  messageQuery.gt.mockReturnValue(messageQuery);

  const sessionQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => session)
  };
  sessionQuery.select.mockReturnValue(sessionQuery);
  sessionQuery.eq.mockReturnValue(sessionQuery);

  const outboxQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    contains: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => outbox)
  };
  outboxQuery.select.mockReturnValue(outboxQuery);
  outboxQuery.eq.mockReturnValue(outboxQuery);
  outboxQuery.contains.mockReturnValue(outboxQuery);
  outboxQuery.order.mockReturnValue(outboxQuery);
  outboxQuery.limit.mockReturnValue(outboxQuery);

  const from = vi.fn((table: string) => {
    if (table === 'human_messages') return messageQuery;
    if (table === 'sessions') return sessionQuery;
    if (table === 'handoff_outbox') return outboxQuery;
    throw new Error(`Unexpected table: ${table}`);
  });

  return { supabase: { from }, from, messageQuery, sessionQuery, outboxQuery };
}

async function poll(supabase: ReturnType<typeof buildSupabase>['supabase']) {
  requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId: 'sess-relay' }, supabase });
  const { GET } = await import('@/app/api/telegram/messages/route');
  return GET(new Request('http://localhost/api/telegram/messages?sessionId=sess-relay'));
}

function expectNoPrivateKeys(value: unknown) {
  const forbidden = ['telegram', 'thread', 'handoff', 'provider', 'token', 'capability', 'payload', 'last_error', 'routing'];
  const visit = (current: unknown) => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      expect(forbidden.some((term) => key.toLowerCase().includes(term)), `private key ${key}`).toBe(false);
      visit(child);
    }
  };
  visit(value);
}

describe('GET /api/telegram/messages relay status', () => {
  beforeEach(() => {
    vi.resetModules();
    requireSessionMock.mockReset();
  });

  test('projects a pending relay outbox as queued using the public allowlist', async () => {
    const response = await poll(buildSupabase().supabase);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(queuedPollFixture);
    expectNoPrivateKeys(body);
  });

  test.each(['claiming', 'sending'])('keeps %s queued regardless of elapsed time', async (state) => {
    const { supabase } = buildSupabase({
      outbox: {
        data: {
          state,
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-02T00:00:00.000Z',
          payload: { type: 'relay' }
        },
        error: null
      }
    });

    await expect((await poll(supabase)).json()).resolves.toMatchObject({ outgoingStatus: 'queued' });
  });

  test.each(['failed', 'escalated'])('projects terminal %s delivery as unavailable without provider detail', async (state) => {
    const { supabase } = buildSupabase({
      outbox: {
        data: {
          state,
          payload: { type: 'relay', provider: 'telegram', last_error: 'private provider failure' }
        },
        error: null
      }
    });

    const body = await (await poll(supabase)).json();
    expect(body.outgoingStatus).toBe('unavailable');
    expectNoPrivateKeys(body);
  });

  test.each(['failed', 'escalated'])('keeps a complete durable receipt delivered when state is %s', async (state) => {
    const { supabase } = buildSupabase({
      outbox: {
        data: { state, payload: { type: 'relay', telegramMessageId: 502, telegramThreadId: 77 } },
        error: null
      }
    });

    await expect((await poll(supabase)).json()).resolves.toMatchObject({ outgoingStatus: 'delivered' });
  });

  test('projects a sent relay outbox as delivered without exposing its metadata', async () => {
    const { supabase } = buildSupabase({
      outbox: { data: { state: 'sent', payload: { type: 'relay', provider: 'telegram' } }, error: null }
    });
    const body = await (await poll(supabase)).json();

    expect(body.outgoingStatus).toBe('delivered');
    expectNoPrivateKeys(body);
  });

  test('projects a complete persisted numeric receipt as delivered before state completion', async () => {
    const { supabase } = buildSupabase({
      outbox: {
        data: { state: 'pending', payload: { type: 'relay', telegramMessageId: 502, telegramThreadId: 77 } },
        error: null
      }
    });

    await expect((await poll(supabase)).json()).resolves.toMatchObject({ outgoingStatus: 'delivered' });
  });

  test.each([
    { type: 'relay' },
    { type: 'relay', telegramMessageId: 502 },
    { type: 'relay', telegramThreadId: 77 },
    { type: 'relay', telegramMessageId: '502', telegramThreadId: 77 }
  ])('keeps an absent, partial, or nonnumeric receipt queued', async (payload) => {
    const { supabase } = buildSupabase({ outbox: { data: { state: 'pending', payload }, error: null } });

    await expect((await poll(supabase)).json()).resolves.toMatchObject({ outgoingStatus: 'queued' });
  });

  test('returns null when no relay outbox exists', async () => {
    const { supabase } = buildSupabase({ outbox: { data: null, error: null } });

    await expect((await poll(supabase)).json()).resolves.toMatchObject({ outgoingStatus: null });
  });

  test('queries only the newest relay outbox for the authenticated session', async () => {
    const { supabase, outboxQuery } = buildSupabase();
    await poll(supabase);

    expect(outboxQuery.select).toHaveBeenCalledWith('state, payload');
    expect(outboxQuery.eq).toHaveBeenCalledWith('session_id', 'sess-relay');
    expect(outboxQuery.contains).toHaveBeenCalledWith('payload', { type: 'relay' });
    expect(outboxQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(outboxQuery.limit).toHaveBeenCalledWith(1);
    expect(outboxQuery.maybeSingle).toHaveBeenCalledOnce();
  });

  test('normalizes control characters and whitespace and bounds stored replies to 4,000 characters', async () => {
    const text = `\u0000  Avery:\n\tWe\u0007 can help.  ${'x'.repeat(5000)}`;
    const { supabase } = buildSupabase({ messages: { data: [{ ...teamReply, text }], error: null } });
    const body = await (await poll(supabase)).json();

    expect(body.messages[0].text).toHaveLength(4000);
    expect(body.messages[0].text).toBe(`Avery: We can help. ${'x'.repeat(3980)}`);
  });

  test.each(['messages', 'session', 'outbox'] as const)('returns only the stable 503 body when the %s read fails', async (read) => {
    const databaseError = { message: 'telegram provider token failed', details: 'routing secret' };
    const options = { [read]: { data: null, error: databaseError } };
    const response = await poll(buildSupabase(options).supabase);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'relay_status_unavailable' });
    expectNoPrivateKeys(body);
  });

  test('rejects an unauthenticated session before any persisted read', async () => {
    const { GET } = await import('@/app/api/telegram/messages/route');
    const { supabase, from } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Session capability required' }, { status: 401 })
    });
    const request = new Request('http://localhost/api/telegram/messages?sessionId=other-session');

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(requireSessionMock).toHaveBeenCalledWith(request, 'other-session');
    expect(from).not.toHaveBeenCalled();
    expect(supabase).toBeDefined();
  });

  test('rejects an authenticated but unrelated session before any persisted read', async () => {
    const { GET } = await import('@/app/api/telegram/messages/route');
    const { from } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Session mismatch' }, { status: 403 })
    });
    const request = new Request('http://localhost/api/telegram/messages?sessionId=other-session');

    const response = await GET(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Session mismatch' });
    expect(requireSessionMock).toHaveBeenCalledWith(request, 'other-session');
    expect(from).not.toHaveBeenCalled();
  });
});
