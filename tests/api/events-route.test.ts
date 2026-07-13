// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

describe('POST /api/events', () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
  });

  test('requires session authorization', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Session capability required' }), { status: 401 })
    });

    const { POST } = await import('@/app/api/events/route');
    const request = new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({ sessionId: 'sess-1', eventName: 'widget_closed' })
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  test('rejects unknown event names', async () => {
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-1', capability: 'cap' },
      supabase: {
        from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: null })) }))
      }
    });

    const { POST } = await import('@/app/api/events/route');
    const request = new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({ sessionId: 'sess-1', eventName: 'totally_unknown_event' })
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  test('persists allowlisted event names for the authenticated session', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-1', capability: 'cap' },
      supabase: {
        from: vi.fn(() => ({
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            inserts.push(payload);
            return { error: null };
          })
        }))
      }
    });

    const { POST } = await import('@/app/api/events/route');
    const request = new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({
        sessionId: 'sess-1',
        eventName: 'widget_closed',
        properties: { source: 'widget' }
      })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      session_id: 'sess-1',
      event_name: 'widget_closed'
    });
  });
});
