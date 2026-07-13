// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  hasSupabaseServerConfigMock,
  createServerSupabaseClientMock,
  claimNextHandoffMock,
  markDeliveredMock,
  markFailedMock,
  sendTelegramMessageMock,
  validateAdminRequestAnyMock,
  emitEventMock
} = vi.hoisted(() => ({
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn(() => ({})),
  claimNextHandoffMock: vi.fn(),
  markDeliveredMock: vi.fn(),
  markFailedMock: vi.fn(),
  sendTelegramMessageMock: vi.fn(),
  validateAdminRequestAnyMock: vi.fn(() => ({ ok: true })),
  emitEventMock: vi.fn()
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

vi.mock('@/lib/handoff/outbox', () => ({
  claimNextHandoff: claimNextHandoffMock,
  markDelivered: markDeliveredMock,
  markFailed: markFailedMock
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock
}));

vi.mock('@/lib/security/config', () => ({
  validateAdminRequestAny: validateAdminRequestAnyMock
}));

vi.mock('@/lib/observability/events', () => ({
  emitEvent: emitEventMock
}));

describe('POST /api/internal/handoff-dispatch delivery events', () => {
  beforeEach(() => {
    claimNextHandoffMock.mockReset();
    markDeliveredMock.mockReset();
    markFailedMock.mockReset();
    sendTelegramMessageMock.mockReset();
    emitEventMock.mockReset();
    validateAdminRequestAnyMock.mockReturnValue({ ok: true });
  });

  test('emits handoff_delivered when a claimed handoff is sent', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-1',
        session_id: 'sess-1',
        created_at: '2026-07-11T11:59:00.000Z',
        payload: { sessionId: 'sess-1', type: 'approval', summary: 'Hello' }
      })
      .mockResolvedValueOnce(null);
    sendTelegramMessageMock.mockResolvedValue({ messageId: 1 });

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const response = await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret', 'x-request-id': 'rid-dispatch' }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.processed).toBe(1);
    expect(markDeliveredMock).toHaveBeenCalledWith(expect.anything(), 'ho-1');
    expect(emitEventMock).toHaveBeenCalledWith(
      'handoff_delivered',
      expect.objectContaining({ handoffId: 'ho-1', durationMs: expect.any(Number) }),
      'rid-dispatch'
    );
  });

  test('emits handoff_escalated when a send failure escalates', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-2',
        session_id: 'sess-2',
        created_at: '2026-07-11T11:59:00.000Z',
        payload: { sessionId: 'sess-2', type: 'approval', summary: 'Hello' }
      })
      .mockResolvedValueOnce(null);
    sendTelegramMessageMock.mockResolvedValue(null);
    markFailedMock.mockResolvedValue({ shouldRetry: false, escalated: true, retryDelayMs: 0 });

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const response = await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret', 'x-request-id': 'rid-dispatch' }
    }));

    expect(response.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith(
      'handoff_escalated',
      { handoffId: 'ho-2', reason: 'Telegram send failed' },
      'rid-dispatch'
    );
  });

  test('does not send a handoff suppressed at claim time for an expired or revoked session', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-expired',
        session_id: 'sess-expired',
        created_at: '2026-07-11T11:59:00.000Z',
        payload: { sessionId: 'sess-expired', type: 'approval', summary: 'Do not send' },
        resolution: 'suppressed'
      })
      .mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const response = await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret', 'x-request-id': 'rid-dispatch' }
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [{ id: 'ho-expired', status: 'suppressed' }]
    });
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(markDeliveredMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(emitEventMock).toHaveBeenCalledWith(
      'handoff_suppressed',
      { handoffId: 'ho-expired', reason: 'session_unavailable' },
      'rid-dispatch'
    );
  });
});
