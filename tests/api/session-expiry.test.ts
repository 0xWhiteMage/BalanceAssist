// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { client, hasConfig } = vi.hoisted(() => ({
  hasConfig: vi.fn(() => true),
  client: { rpc: vi.fn(async () => ({ data: { deleted_sessions: 2, deferred_sessions: 1, released_claims: 0 }, error: null })) }
}));
vi.mock('@/lib/supabase/server', () => ({ hasSupabaseServerConfig: hasConfig, createServerSupabaseClient: vi.fn(() => client) }));
const emitEventMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/observability/events', () => ({ emitEvent: emitEventMock }));
const cleanupPrivateUploadsMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/uploads/private-storage', () => ({
  privateUploadBucketFromEnv: () => process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET ?? null,
  cleanupExpiredStoredUploads: cleanupPrivateUploadsMock
}));

describe('POST /api/internal/session-expiry', () => {
  beforeEach(() => { vi.resetModules(); client.rpc.mockClear(); emitEventMock.mockReset(); cleanupPrivateUploadsMock.mockReset(); delete process.env.CRON_SECRET; delete process.env.INTERNAL_DISPATCH_SECRET; delete process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET; });
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
  test('reports private object cleanup only after the storage adapter deletes objects', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';
    cleanupPrivateUploadsMock.mockResolvedValue({ deleted: 2, failed: 1, deferredSessionIds: ['session-with-object'], complete: true });
    const { POST } = await import('@/app/api/internal/session-expiry/route');

    const response = await POST(new Request('https://example.test/api/internal/session-expiry', { method: 'POST', headers: { authorization: 'Bearer secret' } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deletedSessions: 2, deferredSessions: 1, releasedClaims: 0, deletedStoredObjects: 2, failedStoredObjectDeletes: 1 });
    expect(cleanupPrivateUploadsMock).toHaveBeenCalledWith(client, 'temporary-attachments');
    expect(client.rpc).toHaveBeenCalledWith('purge_expired_temporary_sessions', { p_deferred_session_ids: ['session-with-object'] });
  });
  test('does not purge any sessions when private object cleanup is incomplete', async () => {
    process.env.CRON_SECRET = 'secret';
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';
    cleanupPrivateUploadsMock.mockResolvedValue({ deleted: 0, failed: 1, deferredSessionIds: [], complete: false });
    const { POST } = await import('@/app/api/internal/session-expiry/route');

    const response = await POST(new Request('https://example.test/api/internal/session-expiry', { method: 'POST', headers: { authorization: 'Bearer secret' } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Private attachment cleanup incomplete' });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
