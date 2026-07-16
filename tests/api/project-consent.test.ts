// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));

vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));

function buildSupabase() {
  const rpc = vi.fn(async () => ({ data: [{ analysis: true, producer_transfer: false, human_contact: false }], error: null }));
  return {
    client: {
      rpc
    }
  };
}

describe('POST /api/projects/[sessionId]/consent', () => {
  beforeEach(() => {
    vi.resetModules();
    requireSessionMock.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  test('records an explicit authenticated transition through the session-locked RPC', async () => {
    const { client } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'session-1', capability: 'session-1.capability' },
      supabase: client
    });

    const { POST } = await import('@/app/api/projects/[sessionId]/consent/route');
    const response = await POST(new Request('https://www.balancestudio.tv/api/projects/session-1/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({ scope: 'analysis', granted: true, noticeVersion: '1.1' })
    }), { params: Promise.resolve({ sessionId: 'session-1' }) });

    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('record_session_consent', {
      p_session_id: 'session-1',
      p_scope: 'analysis',
      p_granted: true,
      p_notice_version: '1.1'
    });
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

  test('records human contact separately from producer transfer', async () => {
    const { client } = buildSupabase();
    client.rpc.mockResolvedValue({ data: [{ analysis: false, producer_transfer: false, human_contact: true }], error: null });
    requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId: 'session-1', capability: 'x' }, supabase: client });
    const { POST } = await import('@/app/api/projects/[sessionId]/consent/route');
    const response = await POST(new Request('https://www.balancestudio.tv/api/projects/session-1/consent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'human_contact', granted: true, noticeVersion: '1.1' })
    }), { params: Promise.resolve({ sessionId: 'session-1' }) });

    expect(client.rpc).toHaveBeenCalledWith('record_session_consent', expect.objectContaining({ p_scope: 'human_contact' }));
    await expect(response.json()).resolves.toMatchObject({ consent: { humanContact: true, producerTransfer: false } });
  });

  test('returns authentication failures without writing a transition', async () => {
    const { client } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ ok: false, code: 'SESSION_CAPABILITY_REQUIRED' }), { status: 401 })
    });
    const { POST } = await import('@/app/api/projects/[sessionId]/consent/route');
    const response = await POST(new Request('https://www.balancestudio.tv/api/projects/session-1/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({ scope: 'analysis', granted: true, noticeVersion: '1.1' })
    }), { params: Promise.resolve({ sessionId: 'session-1' }) });

    expect(response.status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
