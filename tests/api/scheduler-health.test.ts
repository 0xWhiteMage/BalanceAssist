// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { client, hasConfig } = vi.hoisted(() => ({
  hasConfig: vi.fn(() => true),
  client: { rpc: vi.fn() }
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasConfig,
  createServerSupabaseClient: vi.fn(() => client)
}));

describe('scheduler health routes', () => {
  beforeEach(() => {
    vi.resetModules();
    client.rpc.mockReset();
    hasConfig.mockReturnValue(true);
    delete process.env.CRON_SECRET;
    delete process.env.INTERNAL_DISPATCH_SECRET;
  });

  test('records an authenticated worker heartbeat', async () => {
    process.env.CRON_SECRET = 'scheduler-secret';
    client.rpc.mockResolvedValue({ error: null });
    const { POST } = await import('@/app/api/internal/scheduler-heartbeat/route');

    const response = await POST(new Request('https://example.test/api/internal/scheduler-heartbeat', {
      method: 'POST', headers: { authorization: 'Bearer scheduler-secret', 'content-type': 'application/json' }, body: JSON.stringify({ worker: 'handoff-dispatch' })
    }));

    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('record_scheduler_heartbeat', { p_worker: 'handoff-dispatch' });
  });

  test('accepts the deletion worker heartbeat emitted by its GitHub workflow', async () => {
    process.env.CRON_SECRET = 'scheduler-secret';
    client.rpc.mockResolvedValue({ error: null });
    const { POST } = await import('@/app/api/internal/scheduler-heartbeat/route');
    const response = await POST(new Request('https://example.test/api/internal/scheduler-heartbeat', {
      method: 'POST', headers: { authorization: 'Bearer scheduler-secret', 'content-type': 'application/json' }, body: JSON.stringify({ worker: 'deletion-worker' })
    }));
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('record_scheduler_heartbeat', { p_worker: 'deletion-worker' });
  });

  test('returns alert-ready failure when worker, outbox, or expiry checks are unhealthy', async () => {
    process.env.CRON_SECRET = 'scheduler-secret';
    client.rpc.mockResolvedValue({ data: { healthy: false, stale_workers: ['handoff-dispatch', 'deletion-worker'], oldest_pending_outbox_seconds: 901, expired_session_backlog: 2, oldest_pending_deletion_seconds: 901, pending_deletion_count: 3 }, error: null });
    const { GET } = await import('@/app/api/internal/scheduler-health/route');

    const response = await GET(new Request('https://example.test/api/internal/scheduler-health', { headers: { authorization: 'Bearer scheduler-secret' } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, staleWorkers: ['handoff-dispatch', 'deletion-worker'], oldestPendingOutboxSeconds: 901, expiredSessionBacklog: 2, oldestPendingDeletionSeconds: 901, pendingDeletionCount: 3 });
  });
});
