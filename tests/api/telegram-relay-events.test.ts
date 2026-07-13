// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock, sendTelegramMessageMock, ensureTelegramTopicMock, enqueueHandoffMock, emitEventMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sendTelegramMessageMock: vi.fn(),
  ensureTelegramTopicMock: vi.fn(async () => null),
  enqueueHandoffMock: vi.fn(async () => ({ persisted: true, queued: true, delivered: false, retryable: false })),
  emitEventMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock,
  ensureTelegramTopic: ensureTelegramTopicMock,
  editForumTopic: vi.fn(async () => true)
}));

vi.mock('@/lib/observability/events', () => ({
  emitEvent: emitEventMock
}));

vi.mock('@/lib/handoff/outbox', () => ({ enqueueHandoff: enqueueHandoffMock }));

function createSupabase(consentTransitions: Array<{ scope: string; granted: boolean }> = [{ scope: 'producer_transfer', granted: true }]) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { telegram_thread_id: 42, contact_name: 'Sam', contact_company: 'Acme' },
                error: null
              }))
            }))
          })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
        };
      }

      if (table === 'human_messages') {
        return {
          insert: vi.fn(async () => ({ error: null }))
        };
      }

      if (table === 'session_consents') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: consentTransitions, error: null }))
            }))
          }))
        };
      }

      throw new Error(`Unexpected table ${table}`);
    })
  };
}

describe('POST /api/telegram/relay delivery events', () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    sendTelegramMessageMock.mockReset();
    ensureTelegramTopicMock.mockReset();
    emitEventMock.mockReset();
  });

  test('emits handoff_delivered when Telegram accepts the relayed message', async () => {
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-relay', capability: 'cap' },
      supabase: createSupabase()
    });

    const { POST } = await import('@/app/api/telegram/relay/route');
    const request = new Request('http://localhost/api/telegram/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'rid-relay' },
      body: JSON.stringify({ sessionId: 'sess-relay', text: 'Hello team' })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, queued: true, telegramSent: false });
    expect(enqueueHandoffMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  test('emits handoff_failed when Telegram does not accept the relayed message', async () => {
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-relay', capability: 'cap' },
      supabase: createSupabase()
    });

    const { POST } = await import('@/app/api/telegram/relay/route');
    const request = new Request('http://localhost/api/telegram/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'rid-relay' },
      body: JSON.stringify({ sessionId: 'sess-relay', text: 'Hello team' })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  test('does not create a topic or send Telegram when producer-transfer consent is absent', async () => {
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-relay', capability: 'cap' },
      supabase: createSupabase([])
    });

    const { POST } = await import('@/app/api/telegram/relay/route');
    const response = await POST(new Request('http://localhost/api/telegram/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-relay', text: 'Hello team' })
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'consent_required' });
    expect(ensureTelegramTopicMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });
});
