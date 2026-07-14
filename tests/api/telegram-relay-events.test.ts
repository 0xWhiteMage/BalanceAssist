// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));
vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));

describe('POST /api/telegram/relay', () => {
  const rpc = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId: 'sess-relay' }, supabase: { rpc } });
  });

  test('uses the request ID for atomic message and outbox persistence', async () => {
    rpc.mockResolvedValue({ data: [{ persisted: true, consent_required: false, message_id: 33, handoff_id: 'handoff-33', thread_id: 42 }], error: null });
    const { POST } = await import('@/app/api/telegram/relay/route');
    const response = await POST(new Request('http://localhost/api/telegram/relay', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'retry-key' }, body: JSON.stringify({ sessionId: 'sess-relay', text: 'Same text' })
    }));

    expect(rpc).toHaveBeenCalledWith('relay_human_message', { p_session_id: 'sess-relay', p_request_id: 'retry-key', p_text: 'Same text' });
    await expect(response.json()).resolves.toMatchObject({ ok: true, queued: true, messageId: 33, handoffId: 'handoff-33' });
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
});
