// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));

vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));

function buildSupabase(transitions: Array<{ scope: string; granted: boolean }> = []) {
  const inserts: Array<Record<string, unknown>> = [];
  return {
    inserts,
    client: {
      from: vi.fn((table: string) => {
        if (table === 'session_consents') {
          return {
            insert: vi.fn(async (row: Record<string, unknown>) => {
              inserts.push(row);
              return { error: null };
            }),
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(async () => ({ data: transitions, error: null }))
              }))
            }))
          };
        }
        return {};
      })
    }
  };
}

describe('POST /api/projects/[sessionId]/consent', () => {
  beforeEach(() => {
    vi.resetModules();
    requireSessionMock.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  test('persists an explicit authenticated transition before returning ledger state', async () => {
    const { client, inserts } = buildSupabase([{ scope: 'analysis', granted: true }]);
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'session-1', capability: 'session-1.capability' },
      supabase: client
    });

    const { POST } = await import('@/app/api/projects/[sessionId]/consent/route');
    const response = await POST(new Request('https://www.balancestudio.tv/api/projects/session-1/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({ scope: 'analysis', granted: true, noticeVersion: '1.0' })
    }), { params: Promise.resolve({ sessionId: 'session-1' }) });

    expect(response.status).toBe(200);
    expect(inserts).toEqual([{
      session_id: 'session-1',
      scope: 'analysis',
      granted: true,
      notice_version: '1.0',
      provenance: 'session_capability'
    }]);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      consent: { analysis: true, producerTransfer: false }
    });
  });

  test('rejects unsupported notice versions with a stable error code', async () => {
    const { client } = buildSupabase();
    requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId: 'session-1', capability: 'x' }, supabase: client });
    const { POST } = await import('@/app/api/projects/[sessionId]/consent/route');
    const response = await POST(new Request('https://www.balancestudio.tv/api/projects/session-1/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({ scope: 'analysis', granted: true, noticeVersion: '0.1' })
    }), { params: Promise.resolve({ sessionId: 'session-1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'UNSUPPORTED_NOTICE_VERSION' });
  });

  test('returns authentication failures without writing a transition', async () => {
    const { client, inserts } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ ok: false, code: 'SESSION_CAPABILITY_REQUIRED' }), { status: 401 })
    });
    const { POST } = await import('@/app/api/projects/[sessionId]/consent/route');
    const response = await POST(new Request('https://www.balancestudio.tv/api/projects/session-1/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({ scope: 'analysis', granted: true, noticeVersion: '1.0' })
    }), { params: Promise.resolve({ sessionId: 'session-1' }) });

    expect(response.status).toBe(401);
    expect(inserts).toEqual([]);
  });
});
