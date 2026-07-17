// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { emitEventMock, requireSessionMock } = vi.hoisted(() => ({
  emitEventMock: vi.fn(),
  requireSessionMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/observability/events', () => ({ emitEvent: emitEventMock }));

function request(payload: unknown, headers?: Record<string, string>) {
  return new Request('http://localhost/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv', ...headers },
    body: JSON.stringify(payload)
  });
}

function authorize({ insertError = null, deletionState = 'active' }: { insertError?: unknown; deletionState?: string } = {}) {
  const insert = vi.fn(async () => ({ error: insertError }));
  requireSessionMock.mockResolvedValue({
    ok: true,
    auth: { sessionId: 'sess-1', capability: 'cap' },
    supabase: {
      from: vi.fn((table: string) => table === 'sessions'
        ? {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { deletion_state: deletionState }, error: null })) }))
            }))
          }
        : { insert })
    }
  });
  return insert;
}

describe('POST /api/events', () => {
  beforeEach(() => {
    emitEventMock.mockReset();
    requireSessionMock.mockReset();
  });

  test('requires session authorization', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Session capability required' }), { status: 401 })
    });
    const { POST } = await import('@/app/api/events/route');
    const response = await POST(request({ sessionId: 'sess-1', eventName: 'widget_closed' }));
    expect(response.status).toBe(401);
  });

  test('persists property-free operational events', async () => {
    const insert = authorize();
    const { POST } = await import('@/app/api/events/route');
    const response = await POST(request({ sessionId: 'sess-1', eventName: 'human_handoff' }));
    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith({ session_id: 'sess-1', event_name: 'human_handoff', properties: null });
  });

  test.each(['clarity_helpfulness', 'comfort', 'reuse'] as const)(
    'persists bounded %s feedback and emits schema-only observability',
    async (dimension) => {
      const insert = authorize();
      const { POST } = await import('@/app/api/events/route');
      const response = await POST(request({
        sessionId: 'sess-1',
        eventName: 'trust_feedback',
        properties: { dimension, response: 'yes' }
      }, { 'x-request-id': '4fb6bf26-306d-4d7a-a967-e602bcfc05f5' }));

      expect(response.status).toBe(200);
      expect(insert).toHaveBeenCalledWith({
        session_id: 'sess-1',
        event_name: 'trust_feedback',
        properties: { dimension, response: 'yes' }
      });
      expect(emitEventMock).toHaveBeenCalledWith(
        'trust_feedback',
        { sessionId: 'sess-1', dimension, response: 'yes' },
        '4fb6bf26-306d-4d7a-a967-e602bcfc05f5'
      );
    }
  );

  test.each([
    { eventName: 'totally_unknown_event' },
    { eventName: 'deletion_requested' },
    { eventName: 'llm_request', properties: { category: 'reply', has_draft: true } },
    { eventName: 'widget_closed', properties: { source: 'free text' } },
    { eventName: 'trust_feedback', properties: { dimension: 'clarity_helpfulness', response: 'maybe' } },
    { eventName: 'trust_feedback', properties: { dimension: 'clarity_helpfulness', response: 'yes', comment: 'private text' } },
    { eventName: 'trust_feedback', properties: { dimension: 'clarity_helpfulness', response: 'yes', transcript: 'private transcript' } },
    { eventName: 'trust_feedback', properties: { dimension: 'clarity_helpfulness', response: 'yes', email: 'user@example.com' } },
    { eventName: 'trust_feedback', properties: { dimension: 'clarity_helpfulness', response: 'yes', providerError: 'token failed' } }
  ])('rejects unbounded payload %# without authorization or persistence', async (event) => {
    const { POST } = await import('@/app/api/events/route');
    const response = await POST(request({ sessionId: 'sess-1', ...event }));
    expect(response.status).toBe(400);
    expect(requireSessionMock).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  test('rejects an oversized payload before authorization', async () => {
    const { POST } = await import('@/app/api/events/route');
    const response = await POST(request({
      sessionId: 'sess-1',
      eventName: 'trust_feedback',
      properties: { dimension: 'clarity_helpfulness', response: 'yes', padding: 'x'.repeat(3_000) }
    }));
    expect(response.status).toBe(413);
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  test('rejects feedback after deletion has frozen the session', async () => {
    const insert = authorize({ deletionState: 'requested' });
    const { POST } = await import('@/app/api/events/route');
    const response = await POST(request({
      sessionId: 'sess-1',
      eventName: 'trust_feedback',
      properties: { dimension: 'clarity_helpfulness', response: 'yes' }
    }));
    expect(response.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  test('does not emit an event when persistence fails', async () => {
    authorize({ insertError: { code: 'db_error' } });
    const { POST } = await import('@/app/api/events/route');
    const response = await POST(request({ sessionId: 'sess-1', eventName: 'widget_closed' }));
    expect(response.status).toBe(500);
    expect(emitEventMock).not.toHaveBeenCalled();
  });
});
