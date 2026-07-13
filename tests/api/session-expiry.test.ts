// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { client, hasConfig } = vi.hoisted(() => ({
  hasConfig: vi.fn(() => true),
  client: { rpc: vi.fn(async () => ({ data: { deleted_sessions: 2, deferred_sessions: 1, released_claims: 0 }, error: null })) }
}));
vi.mock('@/lib/supabase/server', () => ({ hasSupabaseServerConfig: hasConfig, createServerSupabaseClient: vi.fn(() => client) }));
const emitEventMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/observability/events', () => ({ emitEvent: emitEventMock }));

describe('POST /api/internal/session-expiry', () => {
  beforeEach(() => { vi.resetModules(); client.rpc.mockClear(); emitEventMock.mockReset(); delete process.env.CRON_SECRET; delete process.env.INTERNAL_DISPATCH_SECRET; });
  test('requires an internal secret before purging', async () => {
    const { POST } = await import('@/app/api/internal/session-expiry/route');
    const response = await POST(new Request('https://example.test/api/internal/session-expiry', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  test('returns safe purge and active-claim deferral counts after authenticated cleanup', async () => {
    process.env.CRON_SECRET = 'secret';
    const { POST } = await import('@/app/api/internal/session-expiry/route');
    const response = await POST(new Request('https://example.test/api/internal/session-expiry', { method: 'POST', headers: { authorization: 'Bearer secret' } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deletedSessions: 2, deferredSessions: 1, releasedClaims: 0 });
    expect(client.rpc).toHaveBeenCalledWith('purge_expired_temporary_sessions');
    expect(emitEventMock).toHaveBeenCalledWith('temporary_sessions_expired', {
      deletedSessions: 2,
      deferredSessions: 1,
      releasedClaims: 0
    });
  });
});
