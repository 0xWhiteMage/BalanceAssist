// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock, sendTelegramMessageMock, emitEventMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sendTelegramMessageMock: vi.fn(),
  emitEventMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock,
  ensureTelegramTopic: vi.fn(async () => null),
  editForumTopic: vi.fn(async () => true)
}));

vi.mock('@/lib/observability/events', () => ({
  emitEvent: emitEventMock
}));

function createSupabase() {
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

      throw new Error(`Unexpected table ${table}`);
    })
  };
}

describe('POST /api/telegram/relay delivery events', () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    sendTelegramMessageMock.mockReset();
    emitEventMock.mockReset();
  });

  test('emits handoff_delivered when Telegram accepts the relayed message', async () => {
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-relay', capability: 'cap' },
      supabase: createSupabase()
    });
    sendTelegramMessageMock.mockResolvedValue({ messageId: 7 });

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
    expect(emitEventMock).toHaveBeenCalledWith(
      'handoff_delivered',
      expect.objectContaining({ handoffId: 'relay:sess-relay', durationMs: 0 }),
      'rid-relay'
    );
  });

  test('emits handoff_failed when Telegram does not accept the relayed message', async () => {
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-relay', capability: 'cap' },
      supabase: createSupabase()
    });
    sendTelegramMessageMock.mockResolvedValue(null);

    const { POST } = await import('@/app/api/telegram/relay/route');
    const request = new Request('http://localhost/api/telegram/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'rid-relay' },
      body: JSON.stringify({ sessionId: 'sess-relay', text: 'Hello team' })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(emitEventMock).toHaveBeenCalledWith(
      'handoff_failed',
      { handoffId: 'relay:sess-relay', reason: 'telegram_send_failed' },
      'rid-relay'
    );
  });
});
