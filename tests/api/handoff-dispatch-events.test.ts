// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  hasSupabaseServerConfigMock,
  createServerSupabaseClientMock,
  claimNextHandoffMock,
  reserveHandoffSendMock,
  markDeliveredMock,
  markFailedMock,
  sendTelegramMessageMock,
  getSessionConsentMock,
  validateAdminRequestAnyMock,
  emitEventMock
} = vi.hoisted(() => ({
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn(() => ({})),
  claimNextHandoffMock: vi.fn(),
  reserveHandoffSendMock: vi.fn(),
  markDeliveredMock: vi.fn(),
  markFailedMock: vi.fn(),
  sendTelegramMessageMock: vi.fn(),
  getSessionConsentMock: vi.fn(),
  validateAdminRequestAnyMock: vi.fn(() => ({ ok: true })),
  emitEventMock: vi.fn()
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

vi.mock('@/lib/handoff/outbox', () => ({
  claimNextHandoff: claimNextHandoffMock,
  reserveHandoffSend: reserveHandoffSendMock,
  markDelivered: markDeliveredMock,
  markFailed: markFailedMock
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock
}));

vi.mock('@/lib/privacy/session-consent', () => ({
  getSessionConsent: getSessionConsentMock
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
    reserveHandoffSendMock.mockReset();
    markDeliveredMock.mockReset();
    markFailedMock.mockReset();
    sendTelegramMessageMock.mockReset();
    getSessionConsentMock.mockReset();
    emitEventMock.mockReset();
    validateAdminRequestAnyMock.mockReturnValue({ ok: true });
    reserveHandoffSendMock.mockResolvedValue(true);
    markDeliveredMock.mockResolvedValue(true);
    markFailedMock.mockResolvedValue({ shouldRetry: false, escalated: false, retryDelayMs: 0, applied: true });
    getSessionConsentMock.mockResolvedValue({ analysis: false, producerTransfer: true });
  });

  test('emits handoff_delivered when a claimed handoff is sent', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-1',
        session_id: 'sess-1',
        created_at: '2026-07-11T11:59:00.000Z',
        claim_token: '11111111-1111-4111-8111-111111111111',
        payload: { sessionId: 'sess-1', type: 'approval', summary: 'Hello' },
        resolution: 'claimed'
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
    expect(reserveHandoffSendMock).toHaveBeenCalledWith(expect.anything(), 'ho-1', '11111111-1111-4111-8111-111111111111');
    expect(reserveHandoffSendMock.mock.invocationCallOrder[0]).toBeLessThan(sendTelegramMessageMock.mock.invocationCallOrder[0]);
    expect(markDeliveredMock).toHaveBeenCalledWith(expect.anything(), 'ho-1', '11111111-1111-4111-8111-111111111111');
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
        claim_token: '33333333-3333-4333-8333-333333333333',
        payload: { sessionId: 'sess-2', type: 'approval', summary: 'Hello' }
      })
      .mockResolvedValueOnce(null);
    sendTelegramMessageMock.mockResolvedValue(null);
    markFailedMock.mockResolvedValue({ shouldRetry: false, escalated: true, retryDelayMs: 0, applied: true });

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

  test('does not send when its ownership token cannot atomically reserve the bounded send', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-stale',
        session_id: 'sess-stale',
        created_at: '2026-07-11T11:59:00.000Z',
        claim_token: '22222222-2222-4222-8222-222222222222',
        payload: { sessionId: 'sess-stale', type: 'approval', summary: 'Must not duplicate' },
        resolution: 'claimed'
      })
      .mockResolvedValueOnce(null);
    reserveHandoffSendMock.mockResolvedValue(false);

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const response = await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret' }
    }));

    await expect(response.json()).resolves.toMatchObject({ results: [{ id: 'ho-stale', status: 'stale' }] });
    expect(reserveHandoffSendMock).toHaveBeenCalledWith(expect.anything(), 'ho-stale', '22222222-2222-4222-8222-222222222222');
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  test('suppresses an approval handoff revoked after claim and before reservation', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-revoked',
        session_id: 'sess-revoked',
        created_at: '2026-07-11T11:59:00.000Z',
        claim_token: '44444444-4444-4444-8444-444444444444',
        payload: { sessionId: 'sess-revoked', type: 'approval', summary: 'Do not send' },
        resolution: 'claimed'
      })
      .mockResolvedValueOnce(null);
    getSessionConsentMock.mockResolvedValue({ analysis: false, producerTransfer: false });

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const response = await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret', 'x-request-id': 'rid-revoked' }
    }));

    await expect(response.json()).resolves.toMatchObject({ results: [{ id: 'ho-revoked', status: 'suppressed' }] });
    expect(reserveHandoffSendMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });
});
