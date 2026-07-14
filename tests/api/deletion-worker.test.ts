// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';

const { createServerSupabaseClientMock, hasSupabaseServerConfigMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  hasSupabaseServerConfigMock: vi.fn()
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: createServerSupabaseClientMock, hasSupabaseServerConfig: hasSupabaseServerConfigMock }));
vi.mock('@/lib/security/config', () => ({ validateAdminRequestAny: () => ({ ok: true }) }));

import { POST } from '@/app/api/internal/deletion-worker/route';

function workerClient(removeError = false, sessionId: string | null = 'session-1', cleanupOwner: string | null = 'owner-1') {
  const calls: string[] = [];
  const cleanupFilters: Array<[string, string]> = [];
  const cleanupSelections: string[] = [];
  const cleanupDeleteFilters: Array<[string, string]> = [];
  return {
    calls,
    cleanupFilters,
    cleanupSelections,
    cleanupDeleteFilters,
    rpc: vi.fn(async (name: string) => {
      calls.push(name);
      if (name === 'claim_deletion_job') return { data: { id: 'job-1', session_id: sessionId, cleanup_owner_id: cleanupOwner, lease_token: 'token-1' }, error: null };
      if (name === 'start_deletion_job' || name === 'delete_session_for_deletion_job' || name === 'complete_deletion_job' || name === 'complete_orphaned_deletion_job' || name === 'fail_deletion_job') return { data: true, error: null };
      return { data: null, error: null };
    }),
    storage: { from: () => ({ remove: async () => { calls.push('remove-object'); return { error: removeError ? { message: 'nope' } : null }; } }) },
    from: (table: string) => ({
      select: (columns: string) => ({ eq: (column: string, value: string) => ({ eq: (nextColumn: string, nextValue: string) => {
        if (table === 'private_attachment_cleanup') cleanupFilters.push([column, value], [nextColumn, nextValue]);
        if (table === 'private_attachment_cleanup') cleanupSelections.push(columns);
        return { data: table === 'uploaded_files' ? [{ id: 'file-1', object_key: 'opaque-object' }] : table === 'private_attachment_cleanup' ? [{ object_key: 'recovery-object' }] : [], error: null };
      } }) }),
      delete: () => ({ eq: async (column: string, value: string) => {
        if (table === 'private_attachment_cleanup') cleanupDeleteFilters.push([column, value]);
        calls.push(`delete-${table}-row`);
        return { error: null };
      } })
    })
  };
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

  test('uses opaque object keys to select and delete recovery records', async () => {
    const supabase = workerClient();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(supabase);
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';

    await POST(new Request('http://localhost/api/internal/deletion-worker', { method: 'POST' }));

    expect(supabase.cleanupSelections).toEqual(['object_key']);
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
});
