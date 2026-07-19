// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock, sendTelegramMessageMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sendTelegramMessageMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock
}));

function buildSupabase() {
  const writes: Array<{ table: string; op: 'update' | 'insert'; row: Record<string, unknown> }> = [];

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { telegram_thread_id: 42 },
                error: null
              }))
            }))
          })),
          update: vi.fn((row: Record<string, unknown>) => {
            writes.push({ table, op: 'update', row });
            return { eq: vi.fn(async () => ({ error: null })) };
          })
        };
      }

      if (table === 'human_messages') {
        return {
          insert: vi.fn(async (row: Record<string, unknown>) => {
            writes.push({ table, op: 'insert', row });
            return { error: null };
          })
        };
      }

      return {};
    })
  };

  return { supabase, writes };
}

describe('POST /api/telegram/schedule-complete', () => {
  beforeEach(() => {
    sendTelegramMessageMock.mockReset();
    requireSessionMock.mockReset();
  });

  test('fails safely without verified booking evidence and causes no side effects', async () => {
    const { supabase, writes } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-123', capability: 'cap' },
      supabase
    });

    const { POST } = await import('@/app/api/telegram/schedule-complete/route');
    const request = new Request('http://localhost/api/telegram/schedule-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv' },
      body: JSON.stringify({ sessionId: 'sess-123' })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/booking verification required/i);
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test('authenticates before reading an invalid body', async () => {
    requireSessionMock.mockResolvedValue({ ok: false, response: new Response('{}', { status: 401 }) });
    const { POST } = await import('@/app/api/telegram/schedule-complete/route');
    const response = await POST(new Request('http://localhost/api/telegram/schedule-complete', {
      method: 'POST', body: 'not-json'
    }));
    expect(response.status).toBe(401);
  });

  test('rejects an oversized authenticated body', async () => {
    requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId: 'sess-123' }, supabase: {} });
    const { POST } = await import('@/app/api/telegram/schedule-complete/route');
    const response = await POST(new Request('http://localhost/api/telegram/schedule-complete', {
      method: 'POST', headers: { 'content-length': '9000' }, body: '{}'
    }));
    expect(response.status).toBe(413);
  });
});
