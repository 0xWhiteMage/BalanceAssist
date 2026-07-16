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

  test('accepts Monday worker heartbeats', async () => {
    process.env.CRON_SECRET = 'scheduler-secret';
    client.rpc.mockResolvedValue({ error: null });
    const { POST } = await import('@/app/api/internal/scheduler-heartbeat/route');

    const response = await POST(new Request('https://example.test/api/internal/scheduler-heartbeat', {
      method: 'POST', headers: { authorization: 'Bearer scheduler-secret', 'content-type': 'application/json' }, body: JSON.stringify({ worker: 'monday-dispatch' })
    }));

    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('record_scheduler_heartbeat', { p_worker: 'monday-dispatch' });
  });

  test('accepts the weekly Monday reconciliation heartbeat', async () => {
    process.env.CRON_SECRET = 'scheduler-secret';
    client.rpc.mockResolvedValue({ error: null });
    const { POST } = await import('@/app/api/internal/scheduler-heartbeat/route');
    const response = await POST(new Request('https://example.test/api/internal/scheduler-heartbeat', {
      method: 'POST', headers: { authorization: 'Bearer scheduler-secret', 'content-type': 'application/json' }, body: JSON.stringify({ worker: 'monday-reconcile' })
    }));
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('record_scheduler_heartbeat', { p_worker: 'monday-reconcile' });
  });

  test('passes disabled Monday lanes to health so they cannot make global health fail', async () => {
    process.env.CRON_SECRET = 'scheduler-secret';
    client.rpc.mockResolvedValue({ data: { healthy: true, stale_workers: [], oldest_pending_outbox_seconds: null, expired_session_backlog: 0, oldest_pending_deletion_seconds: null, pending_deletion_count: 0 }, error: null });
    const { GET } = await import('@/app/api/internal/scheduler-health/route');

    const response = await GET(new Request('https://example.test/api/internal/scheduler-health', { headers: { authorization: 'Bearer scheduler-secret' } }));

    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('scheduler_health', { p_monday_dispatch_enabled: false, p_monday_lifecycle_enabled: false, p_monday_reconcile_enabled: false });
  });

  test('returns alert-ready failure when worker, outbox, or expiry checks are unhealthy', async () => {
    process.env.CRON_SECRET = 'scheduler-secret';
    client.rpc.mockResolvedValue({ data: { healthy: false, stale_workers: ['handoff-dispatch', 'deletion-worker', 'monday-dispatch'], oldest_pending_outbox_seconds: 901, expired_session_backlog: 2, oldest_pending_deletion_seconds: 901, pending_deletion_count: 3, oldest_pending_monday_seconds: 901, monday_delivery_unknown_count: 1, monday_conflict_count: 1, oldest_pending_monday_deletion_seconds: 901, overdue_crm_review_count: 1, oldest_overdue_crm_review_seconds: 901 }, error: null });
    const { GET } = await import('@/app/api/internal/scheduler-health/route');

    const response = await GET(new Request('https://example.test/api/internal/scheduler-health', { headers: { authorization: 'Bearer scheduler-secret' } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, staleWorkers: ['handoff-dispatch', 'deletion-worker', 'monday-dispatch'], oldestPendingOutboxSeconds: 901, expiredSessionBacklog: 2, oldestPendingDeletionSeconds: 901, pendingDeletionCount: 3, oldestPendingMondaySeconds: 901, mondayDeliveryUnknownCount: 1, mondayConflictCount: 1, mondayFailedCount: 0, mondayExpiredLeaseCount: 0, mondaySchemaIncidentCount: 0, mondayPermissionIncidentCount: 0, mondayRateLimitedCount: 0, oldestPendingMondayDeletionSeconds: 901, overdueCrmReviewCount: 1, oldestOverdueCrmReviewSeconds: 901 });
  });
});
