// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';

const { createServerSupabaseClientMock, hasSupabaseServerConfigMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  hasSupabaseServerConfigMock: vi.fn()
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: createServerSupabaseClientMock, hasSupabaseServerConfig: hasSupabaseServerConfigMock }));
vi.mock('@/lib/security/config', () => ({ validateAdminRequestAny: () => ({ ok: true }) }));

import { POST } from '@/app/api/internal/deletion-worker/route';

function workerClient(removeError = false, sessionId: string | null = 'session-1', cleanupOwner: string | null = 'owner-1', sessionDeleteComplete = true) {
  const calls: string[] = [];
  const cleanupFilters: Array<[string, string]> = [];
  const cleanupSelections: string[] = [];
  const cleanupDeleteFilters: Array<[string, string]> = [];
  const uploadedFileFilters: Array<[string, string]> = [];
  let uploadedFilesAvailable = true;
  let recoveryAvailable = true;
  return {
    calls,
    cleanupFilters,
    cleanupSelections,
    cleanupDeleteFilters,
    rpc: vi.fn(async (name: string) => {
      calls.push(name);
      if (name === 'claim_deletion_job') return { data: { id: 'job-1', session_id: sessionId, cleanup_owner_id: cleanupOwner, lease_token: 'token-1' }, error: null };
      if (name === 'delete_session_for_deletion_job') return { data: sessionDeleteComplete, error: null };
      if (name === 'start_deletion_job' || name === 'complete_deletion_job' || name === 'complete_orphaned_deletion_job' || name === 'fail_deletion_job' || name === 'defer_deletion_job') return { data: true, error: null };
      return { data: null, error: null };
    }),
    storage: { from: () => ({ remove: async () => { calls.push('remove-object'); return { error: removeError ? { message: 'nope' } : null }; } }) },
    uploadedFileFilters,
    from: (table: string) => ({
      select: (columns: string) => ({ eq: (column: string, value: string) => {
        const query = (filters: Array<[string, string]>) => {
          if (table === 'private_attachment_cleanup') cleanupFilters.push(...filters);
          if (table === 'uploaded_files') uploadedFileFilters.push(...filters);
          if (table === 'private_attachment_cleanup') cleanupSelections.push(columns);
        const result = { data: table === 'uploaded_files' && uploadedFilesAvailable ? [{ id: 'file-1', object_key: 'opaque-object' }] : table === 'private_attachment_cleanup' && recoveryAvailable ? [{ object_key: 'recovery-object' }] : [], error: null };
        return { ...result, limit: async () => {
          if (table === 'uploaded_files') uploadedFilesAvailable = false;
          if (table === 'private_attachment_cleanup') recoveryAvailable = false;
          return result;
        } };
        };
        return { eq: (nextColumn: string, nextValue: string) => query([[column, value], [nextColumn, nextValue]]), limit: () => query([[column, value]]).limit() };
      } }),
      delete: () => ({ eq: async (column: string, value: string) => {
        if (table === 'private_attachment_cleanup') cleanupDeleteFilters.push([column, value]);
        calls.push(`delete-${table}-row`);
        return { error: null };
      } })
    })
  };
}

function pagedWorkerClient() {
  const supabase: any = workerClient();
  const files = Array.from({ length: 1001 }, (_, index) => ({ id: `file-${index}`, object_key: `object-${index}` }));
  const recovery = Array.from({ length: 1001 }, (_, index) => ({ object_key: `recovery-${index}` }));
  const originalFrom = supabase.from;
  supabase.from = (table: string) => {
    const base = originalFrom(table);
    if (table !== 'uploaded_files' && table !== 'private_attachment_cleanup') return base;
    const rows = table === 'uploaded_files' ? files : recovery;
    return {
      ...base,
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: async (count: number) => ({ data: rows.splice(0, count), error: null })
          }),
          limit: async (count: number) => ({ data: rows.splice(0, count), error: null })
        })
      })
    };
  };
  return supabase;
}

describe('deletion worker', () => {
  test('removes private objects before metadata then cascades the session and completes its lease', async () => {
    const supabase = workerClient();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    const response = await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(supabase.calls).toEqual(['claim_deletion_job', 'start_deletion_job', 'remove-object', 'delete-uploaded_files-row', 'remove-object', 'delete-private_attachment_cleanup-row', 'delete_session_for_deletion_job', 'complete_deletion_job']);
  });

  test('selects recovery records only for the claimed job cleanup owner', async () => {
    const supabase = workerClient();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));

    expect(supabase.cleanupFilters).toContainEqual(['cleanup_owner_id', 'owner-1']);
  });

  test('drains every uploaded object row regardless of its lifecycle status', async () => {
    const supabase = workerClient();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));

    expect(supabase.uploadedFileFilters).not.toContainEqual(['status', 'stored']);
  });

  test('uses opaque object keys to select and delete recovery records', async () => {
    const supabase = workerClient();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));

    expect(supabase.cleanupSelections).toEqual(['object_key', 'object_key']);
    expect(supabase.cleanupDeleteFilters).toEqual([['object_key', 'recovery-object']]);
  });

  test('completes a claimed job whose session was already cascaded instead of retrying forever', async () => {
    const supabase = workerClient(false, null);
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    const response = await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(supabase.calls).toEqual(['claim_deletion_job', 'complete_orphaned_deletion_job']);
  });

  test('fails the job without deleting the session when private cleanup is uncertain', async () => {
    const supabase = workerClient(true);
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    const response = await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(supabase.calls).toContain('fail_deletion_job');
    expect(supabase.calls).not.toContain('delete_session_for_deletion_job');
  });

  test('defers a legacy live-session job with no opaque owner without touching recovery records', async () => {
    const supabase = workerClient(false, 'session-1', null);
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    const response = await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));

    expect(response.status).toBe(503);
    expect(supabase.calls).not.toContain('remove-object');
    expect(supabase.calls).not.toContain('delete_session_for_deletion_job');
  });

  test('defers Monday-dependent deletion without counting expected provider cleanup as a failure', async () => {
    const supabase = workerClient(false, 'session-1', 'owner-1', false);
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    const response = await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: 'deferred' });
    expect(supabase.calls).toContain('defer_deletion_job');
    expect(supabase.calls).not.toContain('fail_deletion_job');
  });

  test('drains every uploaded and recovery row across bounded pages before deleting the session', async () => {
    const supabase = pagedWorkerClient();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    const response = await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(supabase.calls.filter((call: string) => call === 'remove-object')).toHaveLength(2002);
    expect(supabase.calls.indexOf('delete_session_for_deletion_job')).toBeGreaterThan(supabase.calls.lastIndexOf('remove-object'));
  });
});
