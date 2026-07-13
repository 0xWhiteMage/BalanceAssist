import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

describe('GET /api/sessions/inspect current-session flow', () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns the authenticated current session when no id query is provided', async () => {
    const request = new Request('https://www.balancestudio.tv/api/sessions/inspect', {
      headers: { origin: 'https://www.balancestudio.tv' }
    });

    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: 'sess-current',
                status: 'open',
                source_url: 'https://www.balancestudio.tv',
                telegram_thread_id: 42,
                contact_name: 'Jayden',
                contact_company: 'Balance',
                created_at: '2026-07-11T00:00:00.000Z'
              },
              error: null
            }))
          }))
        }))
      }))
    };

    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-current', capability: 'sess-current.secret' },
      supabase
    });

    const { GET } = await import('@/app/api/sessions/inspect/route');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireSessionMock).toHaveBeenCalledTimes(1);
    expect(requireSessionMock.mock.calls[0][0]).toBe(request);
    expect(requireSessionMock.mock.calls[0][1]).toBeUndefined();
    expect(body).toMatchObject({
      ok: true,
      exists: true,
      session: {
        id: 'sess-current',
        status: 'open',
        source_url: 'https://www.balancestudio.tv'
      }
    });
  });

  test('returns exists=false when there is no valid current session cookie', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Session capability required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    });

    const { GET } = await import('@/app/api/sessions/inspect/route');
    const response = await GET(new Request('http://localhost:3000/api/sessions/inspect'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, exists: false });
  });
});
