// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));
vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));

describe('POST /api/telegram/relay', () => {
  const retryRequestId = '8d1f684d-090c-4f67-80d4-317a88ad9cbe';
  const failedRequestId = '4f6fb9f8-56e4-42c8-922c-b8289f6c38c3';
  const consentRequestId = 'f94ceaa2-04bb-48b8-ac04-6896ac8a1ee4';
  const rpc = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId: 'sess-relay' }, supabase: { rpc } });
  });

  test('uses the request ID for atomic message and outbox persistence', async () => {
    rpc.mockResolvedValue({ data: [{ persisted: true, consent_required: false, message_id: 33, handoff_id: 'handoff-33', thread_id: 42 }], error: null });
    const { POST } = await import('@/app/api/telegram/relay/route');
    const response = await POST(new Request('http://localhost/api/telegram/relay', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': retryRequestId }, body: JSON.stringify({ sessionId: 'sess-relay', text: 'Same text' })
    }));

    expect(rpc).toHaveBeenCalledWith('relay_human_message', { p_session_id: 'sess-relay', p_request_id: retryRequestId, p_text: 'Same text' });
    await expect(response.json()).resolves.toEqual({ ok: true, persisted: true, queued: true });
  });

  test('returns only the stable persistence error when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'provider token and routing failed' } });
    const { POST } = await import('@/app/api/telegram/relay/route');
    const response = await POST(new Request('http://localhost/api/telegram/relay', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': failedRequestId }, body: JSON.stringify({ sessionId: 'sess-relay', text: 'Same text' })
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'relay_persist_failed' });
  });

  test('rejects a relay request without the client retry identity', async () => {
    const { POST } = await import('@/app/api/telegram/relay/route');
    const response = await POST(new Request('http://localhost/api/telegram/relay', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'sess-relay', text: 'Same text' })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'request_id_required' });
    expect(rpc).not.toHaveBeenCalled();
  });

  test('rejects a non-UUID client retry identity', async () => {
    const { POST } = await import('@/app/api/telegram/relay/route');
    const response = await POST(new Request('http://localhost/api/telegram/relay', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'retry-key' }, body: JSON.stringify({ sessionId: 'sess-relay', text: 'Same text' })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'request_id_required' });
    expect(rpc).not.toHaveBeenCalled();
  });

  test('returns consent_required when the human-contact authorization is absent', async () => {
    rpc.mockResolvedValue({ data: [{ persisted: false, consent_required: true }], error: null });
    const { POST } = await import('@/app/api/telegram/relay/route');
    const response = await POST(new Request('http://localhost/api/telegram/relay', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': consentRequestId }, body: JSON.stringify({ sessionId: 'sess-relay', text: 'Same text' })
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'consent_required' });
  });
});
