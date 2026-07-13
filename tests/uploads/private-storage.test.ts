import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanupExpiredStoredUploads, privateStorageAvailable, storePrivateUpload } from '@/lib/uploads/private-storage';

const sessionId = '11111111-2222-3333-4444-555555555555';

function makeFile(name = 'client-brief.pdf') {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x31]);
  const file = new File([bytes], name, { type: 'text/plain' });
  Object.assign(file, { arrayBuffer: async () => bytes.buffer });
  return file;
}

function makeClient(options?: { bucket?: { id: string; public: boolean } | null; readiness?: 'ready' | 'unavailable'; attested?: boolean; insertError?: boolean; cleanupInsertError?: boolean; removeError?: boolean; cleanupDeleteError?: boolean; updateError?: boolean; expiredError?: boolean; expired?: Array<{ id: string; object_key: string; session_id: string; cleanup_required_at?: string | null }>; orphaned?: Array<{ object_key: string; bucket: string }> }) {
  const upload = vi.fn(async () => ({ error: null }));
  const remove = vi.fn(async () => ({ error: options?.removeError ? { message: 'delete failed' } : null }));
  const insert = vi.fn(async () => ({ error: options?.insertError ? { message: 'metadata failed' } : null }));
  const cleanupInsert = vi.fn(async () => ({ error: options?.cleanupInsertError ? { message: 'recovery unavailable' } : null }));
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: options?.updateError ? { message: 'metadata update failed' } : null })) }));
  const metadataDelete = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      lte: vi.fn(() => ({
        limit: vi.fn(async () => ({ data: options?.expired ?? [], error: options?.expiredError ? { message: 'metadata query failed' } : null }))
      }))
    }))
  }));

  return {
    rpc: vi.fn(async () => ({ data: options?.attested ?? true, error: null })),
    storage: {
      getBucket: vi.fn(async () => ({ data: options?.bucket === undefined ? { id: 'temporary-attachments', public: false } : options.bucket, error: null })),
      from: vi.fn(() => ({ upload, remove }))
    },
    from: vi.fn((table: string) => table === 'private_attachment_cleanup'
      ? { insert: cleanupInsert, select: vi.fn(() => ({ eq: vi.fn(() => ({ lte: vi.fn(() => ({ limit: vi.fn(async () => ({ data: options?.orphaned ?? [], error: null })) })) })) })), delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: options?.cleanupDeleteError ? { message: 'cleanup record delete failed' } : null })) })) }
      : table === 'private_attachment_storage_readiness'
        ? { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { status: options?.readiness ?? 'ready' }, error: null })) })) })) }
        : { insert, update, select, delete: metadataDelete }),
    upload,
    remove,
    insert,
    cleanupInsert,
    update,
    metadataDelete
  };
}

afterEach(() => vi.restoreAllMocks());

describe('private attachment storage', () => {
  test('rejects when the configured bucket is unavailable', async () => {
    const client = makeClient({ bucket: null });

    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile() }))
      .rejects.toMatchObject({ code: 'private_storage_unavailable' });
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.insert).not.toHaveBeenCalled();
  });

  test('fails closed when migration readiness says Storage policy management is unavailable', async () => {
    const client = makeClient({ readiness: 'unavailable', attested: false });

    await expect(privateStorageAvailable(client as never, 'temporary-attachments')).resolves.toBe(false);
    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile() }))
      .rejects.toMatchObject({ code: 'private_storage_unavailable' });
    expect(client.upload).not.toHaveBeenCalled();
  });

  test('uses a current policy and grant attestation instead of the migration-time readiness snapshot', async () => {
    const client = makeClient({ readiness: 'ready', attested: false });

    await expect(privateStorageAvailable(client as never, 'temporary-attachments')).resolves.toBe(false);
    expect(client.rpc).toHaveBeenCalledWith('private_attachment_storage_is_ready', { p_bucket: 'temporary-attachments' });
    expect(client.upload).not.toHaveBeenCalled();
  });

  test('stores validated bytes under an opaque key with durable metadata', async () => {
    const client = makeClient();
    const result = await storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile() });

    expect(result).toMatchObject({ status: 'stored', mimeType: 'application/pdf' });
    expect(result.objectKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.objectKey).not.toContain(sessionId);
    expect(result.objectKey).not.toContain('client-brief.pdf');
    expect(client.upload).toHaveBeenCalledWith(result.objectKey, expect.any(Uint8Array), expect.objectContaining({ contentType: 'application/pdf', upsert: false }));
    expect(client.insert).toHaveBeenCalledWith(expect.objectContaining({
      session_id: sessionId,
      object_key: result.objectKey,
      checksum_sha256: '071ba51d826053284a6642847585427ad1b571446ddc39524c1104a82d58dba0',
      retention_expires_at: expect.any(String),
      status: 'stored',
      idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/)
    }));
  });

  test('returns bounded text extracted from validated server-side bytes', async () => {
    const client = makeClient();
    const bytes = new Uint8Array(Buffer.from('Project scope: launch film'));
    const file = new File([bytes], 'brief.txt', { type: 'text/plain' });
    Object.assign(file, { arrayBuffer: async () => bytes.buffer });

    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file }))
      .resolves.toMatchObject({ extractedText: 'Project scope: launch film' });
  });

  test('removes the uploaded object when metadata persistence fails', async () => {
    const client = makeClient({ insertError: true });

    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile() }))
      .rejects.toMatchObject({ code: 'private_storage_metadata_failed' });
    expect(client.remove).toHaveBeenCalledWith([expect.stringMatching(/^[0-9a-f-]{36}$/)]);
  });

  test('retains a pre-reserved opaque cleanup record when metadata rollback deletion fails', async () => {
    const client = makeClient({ insertError: true, removeError: true });

    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile('private-budget.pdf') }))
      .rejects.toMatchObject({ code: 'private_storage_metadata_failed' });

    expect(client.from).toHaveBeenCalledWith('private_attachment_cleanup');
    expect(client.cleanupInsert).toHaveBeenCalledWith(expect.objectContaining({
      bucket: 'temporary-attachments',
      object_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      checksum_sha256: '071ba51d826053284a6642847585427ad1b571446ddc39524c1104a82d58dba0',
      retention_expires_at: expect.any(String),
      status: 'pending_cleanup'
    }));
    expect(JSON.stringify(client.insert.mock.calls)).not.toContain('private-budget.pdf');
    expect(JSON.stringify(client.cleanupInsert.mock.calls)).not.toContain(sessionId);
  });

  test('does not upload an object when durable cleanup recovery cannot be reserved', async () => {
    const client = makeClient({ cleanupInsertError: true });

    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile() }))
      .rejects.toMatchObject({ code: 'private_storage_recovery_unavailable' });

    expect(client.upload).not.toHaveBeenCalled();
  });

  test('never logs the original filename', async () => {
    const client = makeClient({ insertError: true });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile('private-budget.pdf') })).rejects.toBeDefined();
    expect(JSON.stringify(spy.mock.calls)).not.toContain('private-budget.pdf');
  });

  test('deletes expired objects before marking them expired', async () => {
    const client = makeClient({ expired: [{ id: 'file-1', object_key: '0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c', session_id: sessionId }] });

    await expect(cleanupExpiredStoredUploads(client as never, 'temporary-attachments')).resolves.toEqual({ deleted: 1, failed: 0, deferredSessionIds: [], complete: true });
    expect(client.remove).toHaveBeenCalledWith(['0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c']);
    expect(client.update).toHaveBeenCalledWith({ status: 'expired' });
  });

  test('deletes cleanup-required legacy metadata only after its object is removed', async () => {
    const client = makeClient({ expired: [{ id: 'file-1', object_key: '11111111-2222-3333-4444-555555555555/0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c', session_id: sessionId, cleanup_required_at: '2026-01-01T00:00:00Z' }] });

    await expect(cleanupExpiredStoredUploads(client as never, 'temporary-attachments')).resolves.toMatchObject({ deleted: 1, failed: 0, complete: true });
    expect(client.remove).toHaveBeenCalledWith(['11111111-2222-3333-4444-555555555555/0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c']);
    expect(client.metadataDelete).toHaveBeenCalledWith();
  });

  test('fails closed without purge eligibility when expired metadata cannot be queried', async () => {
    const client = makeClient({ expiredError: true });

    await expect(cleanupExpiredStoredUploads(client as never, 'temporary-attachments')).resolves.toEqual({ deleted: 0, failed: 1, deferredSessionIds: [], complete: false });
  });

  test('defers a session when object deletion or metadata expiry marking fails', async () => {
    const expired = [{ id: 'file-1', object_key: '0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c', session_id: sessionId }];

    await expect(cleanupExpiredStoredUploads(makeClient({ expired, removeError: true }) as never, 'temporary-attachments')).resolves.toEqual({ deleted: 0, failed: 1, deferredSessionIds: [sessionId], complete: true });
    await expect(cleanupExpiredStoredUploads(makeClient({ expired, updateError: true }) as never, 'temporary-attachments')).resolves.toEqual({ deleted: 0, failed: 1, deferredSessionIds: [sessionId], complete: true });
  });

  test('fails closed when a bounded page might omit expired objects', async () => {
    const expired = Array.from({ length: 2 }, (_, index) => ({ id: `file-${index}`, object_key: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, session_id: sessionId }));

    await expect(cleanupExpiredStoredUploads(makeClient({ expired }) as never, 'temporary-attachments', 2)).resolves.toEqual({ deleted: 2, failed: 0, deferredSessionIds: [], complete: false });
  });

  test('retries orphan cleanup records during expiry cleanup', async () => {
    const objectKey = '0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c';
    const client = makeClient({ orphaned: [{ object_key: objectKey, bucket: 'temporary-attachments' }] });

    await expect(cleanupExpiredStoredUploads(client as never, 'temporary-attachments')).resolves.toEqual({ deleted: 1, failed: 0, deferredSessionIds: [], complete: true });

    expect(client.remove).toHaveBeenCalledWith([objectKey]);
    expect(client.from).toHaveBeenCalledWith('private_attachment_cleanup');
  });

  test('fails closed when an orphan object or its cleanup record cannot be deleted', async () => {
    const orphaned = [{ object_key: '0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c', bucket: 'temporary-attachments' }];

    await expect(cleanupExpiredStoredUploads(makeClient({ orphaned, removeError: true }) as never, 'temporary-attachments')).resolves.toEqual({ deleted: 0, failed: 1, deferredSessionIds: [], complete: false });
    await expect(cleanupExpiredStoredUploads(makeClient({ orphaned, cleanupDeleteError: true }) as never, 'temporary-attachments')).resolves.toEqual({ deleted: 0, failed: 1, deferredSessionIds: [], complete: false });
  });
});
