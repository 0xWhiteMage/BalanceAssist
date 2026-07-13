// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { client, hasConfig } = vi.hoisted(() => ({
  hasConfig: vi.fn(() => true),
  client: { rpc: vi.fn(async () => ({ data: 2, error: null })) }
}));
vi.mock('@/lib/supabase/server', () => ({ hasSupabaseServerConfig: hasConfig, createServerSupabaseClient: vi.fn(() => client) }));

describe('POST /api/internal/session-expiry', () => {
  beforeEach(() => { vi.resetModules(); client.rpc.mockClear(); delete process.env.CRON_SECRET; delete process.env.INTERNAL_DISPATCH_SECRET; });
  test('requires an internal secret before purging', async () => {
    const { POST } = await import('@/app/api/internal/session-expiry/route');
    const response = await POST(new Request('https://example.test/api/internal/session-expiry', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  test('returns only the deleted session count after authenticated deletion', async () => {
    process.env.CRON_SECRET = 'secret';
    const { POST } = await import('@/app/api/internal/session-expiry/route');
    const response = await POST(new Request('https://example.test/api/internal/session-expiry', { method: 'POST', headers: { authorization: 'Bearer secret' } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deletedSessions: 2 });
    expect(client.rpc).toHaveBeenCalledWith('purge_expired_temporary_sessions');
  });
});
