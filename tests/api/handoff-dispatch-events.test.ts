// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  hasSupabaseServerConfigMock,
  createServerSupabaseClientMock,
  claimNextHandoffMock,
  reserveHandoffSendMock,
  renewHandoffSendMock,
  markDeliveredMock,
  markFailedMock,
  persistTelegramMessageDeliveryMock,
  recordTelegramReceiptMock,
  deferTelegramReceiptPersistenceMock,
  sendTelegramMessageMock,
  ensureTelegramTopicMock,
  getSessionConsentMock,
  validateAdminRequestAnyMock,
  emitEventMock
} = vi.hoisted(() => ({
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn(() => ({})),
  claimNextHandoffMock: vi.fn(),
  reserveHandoffSendMock: vi.fn(),
  renewHandoffSendMock: vi.fn(),
  markDeliveredMock: vi.fn(),
  markFailedMock: vi.fn(),
  persistTelegramMessageDeliveryMock: vi.fn(),
  recordTelegramReceiptMock: vi.fn(),
  deferTelegramReceiptPersistenceMock: vi.fn(),
  sendTelegramMessageMock: vi.fn(),
  ensureTelegramTopicMock: vi.fn(),
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
  renewHandoffSend: renewHandoffSendMock,
  markDelivered: markDeliveredMock,
  markFailed: markFailedMock,
  persistTelegramMessageDelivery: persistTelegramMessageDeliveryMock,
  recordTelegramReceipt: recordTelegramReceiptMock,
  deferTelegramReceiptPersistence: deferTelegramReceiptPersistenceMock
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock,
  ensureTelegramTopic: ensureTelegramTopicMock
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
    renewHandoffSendMock.mockReset();
    markDeliveredMock.mockReset();
    markFailedMock.mockReset();
    persistTelegramMessageDeliveryMock.mockReset();
    recordTelegramReceiptMock.mockReset();
    deferTelegramReceiptPersistenceMock.mockReset();
    sendTelegramMessageMock.mockReset();
    ensureTelegramTopicMock.mockReset();
    getSessionConsentMock.mockReset();
    emitEventMock.mockReset();
    validateAdminRequestAnyMock.mockReturnValue({ ok: true });
    reserveHandoffSendMock.mockResolvedValue(true);
    renewHandoffSendMock.mockResolvedValue(true);
    markDeliveredMock.mockResolvedValue(true);
    markFailedMock.mockResolvedValue({ shouldRetry: false, escalated: false, retryDelayMs: 0, applied: true });
    persistTelegramMessageDeliveryMock.mockResolvedValue(true);
    recordTelegramReceiptMock.mockResolvedValue(true);
    deferTelegramReceiptPersistenceMock.mockResolvedValue(true);
    ensureTelegramTopicMock.mockResolvedValue(77);
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
      { handoffId: 'ho-2', reason: 'telegram_send_failed' },
      'rid-dispatch'
    );
  });

  test('routes a persisted relay through its resolved topic and records the provider message before delivery', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-relay',
        session_id: 'sess-relay',
        created_at: '2026-07-11T11:59:00.000Z',
        claim_token: '66666666-6666-4666-8666-666666666666',
        payload: { sessionId: 'sess-relay', type: 'relay', messageId: 42, summary: 'Private user message', threadId: null },
        resolution: 'claimed'
      })
      .mockResolvedValueOnce(null);
    sendTelegramMessageMock.mockResolvedValue({ messageId: 501 });

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const response = await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret' }
    }));

    expect(response.status).toBe(200);
    expect(ensureTelegramTopicMock).toHaveBeenCalledWith(expect.anything(), 'sess-relay', null, null, 'sess-rel');
    expect(sendTelegramMessageMock).toHaveBeenCalledWith('Private user message', { threadId: 77 });
    expect(persistTelegramMessageDeliveryMock).toHaveBeenCalledWith(expect.anything(), 42, 77, 501);
    expect(persistTelegramMessageDeliveryMock.mock.invocationCallOrder[0]).toBeLessThan(markDeliveredMock.mock.invocationCallOrder[0]);
  });

  test('retries a relay when topic creation fails without sending an unthreaded message', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-topic-failed',
        session_id: 'sess-topic-failed',
        claim_token: '77777777-7777-4777-8777-777777777777',
        payload: { sessionId: 'sess-topic-failed', type: 'relay', messageId: 43, summary: 'Private user message', threadId: null },
        resolution: 'claimed'
      })
      .mockResolvedValueOnce(null);
    ensureTelegramTopicMock.mockResolvedValue(null);
    markFailedMock.mockResolvedValue({ shouldRetry: true, escalated: false, retryDelayMs: 300000, applied: true });

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret' }
    }));

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(markFailedMock).toHaveBeenCalledWith(expect.anything(), 'ho-topic-failed', '77777777-7777-4777-8777-777777777777', 'telegram_topic_unavailable', expect.anything());
  });

  test('does not send when ownership expires while resolving a Telegram topic', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-topic-stale',
        session_id: 'sess-topic-stale',
        claim_token: '88888888-8888-4888-8888-888888888888',
        payload: { sessionId: 'sess-topic-stale', type: 'relay', messageId: 44, summary: 'Private user message' },
        resolution: 'claimed'
      })
      .mockResolvedValueOnce(null);
    renewHandoffSendMock.mockResolvedValue(false);

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret' }
    }));

    expect(renewHandoffSendMock).toHaveBeenCalledWith(expect.anything(), 'ho-topic-stale', '88888888-8888-4888-8888-888888888888');
    expect(ensureTelegramTopicMock.mock.invocationCallOrder[0]).toBeLessThan(renewHandoffSendMock.mock.invocationCallOrder[0]);
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  test('retries receipt persistence without sending a second Telegram message', async () => {
    const claimToken = '99999999-9999-4999-8999-999999999999';
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-receipt', session_id: 'sess-receipt', claim_token: claimToken,
        payload: { sessionId: 'sess-receipt', type: 'relay', messageId: 45, summary: 'Private user message' }, resolution: 'claimed'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ho-receipt', session_id: 'sess-receipt', claim_token: claimToken,
        payload: {
          sessionId: 'sess-receipt', type: 'relay', messageId: 45, summary: 'Private user message',
          telegramMessageId: 502, telegramThreadId: 77
        }, resolution: 'claimed'
      })
      .mockResolvedValueOnce(null);
    sendTelegramMessageMock.mockResolvedValue({ messageId: 502 });
    persistTelegramMessageDeliveryMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST', headers: { authorization: 'Bearer cron-secret' }
    }));
    await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST', headers: { authorization: 'Bearer cron-secret' }
    }));

    expect(recordTelegramReceiptMock).toHaveBeenCalledWith(expect.anything(), 'ho-receipt', claimToken, expect.objectContaining({ telegramMessageId: 502, telegramThreadId: 77 }));
    expect(deferTelegramReceiptPersistenceMock).toHaveBeenCalledWith(expect.anything(), 'ho-receipt', claimToken);
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    expect(markDeliveredMock).toHaveBeenCalledWith(expect.anything(), 'ho-receipt', claimToken);
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

  test('persists and emits a stable code when a sender throws a raw error', async () => {
    claimNextHandoffMock
      .mockResolvedValueOnce({
        id: 'ho-error',
        session_id: 'sess-error',
        created_at: '2026-07-11T11:59:00.000Z',
        claim_token: '55555555-5555-4555-8555-555555555555',
        payload: { sessionId: 'sess-error', type: 'approval', summary: 'Hello' },
        resolution: 'claimed'
      })
      .mockResolvedValueOnce(null);
    sendTelegramMessageMock.mockRejectedValue(new Error('Bearer private-token for user@example.com'));

    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    await POST(new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret', 'x-request-id': 'rid-error' }
    }));

    expect(markFailedMock).toHaveBeenCalledWith(expect.anything(), 'ho-error', '55555555-5555-4555-8555-555555555555', 'handoff_processing_failed', expect.anything());
    expect(emitEventMock).toHaveBeenCalledWith('handoff_failed', { handoffId: 'ho-error', reason: 'handoff_processing_failed' }, 'rid-error');
  });
});
