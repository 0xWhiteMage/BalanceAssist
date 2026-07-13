import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanupExpiredStoredUploads, storePrivateUpload } from '@/lib/uploads/private-storage';

const sessionId = '11111111-2222-3333-4444-555555555555';

function makeFile(name = 'client-brief.pdf') {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x31]);
  const file = new File([bytes], name, { type: 'text/plain' });
  Object.assign(file, { arrayBuffer: async () => bytes.buffer });
  return file;
}

function makeClient(options?: { bucket?: { id: string; public: boolean } | null; insertError?: boolean; removeError?: boolean; expired?: Array<{ id: string; object_key: string }> }) {
  const upload = vi.fn(async () => ({ error: null }));
  const remove = vi.fn(async () => ({ error: options?.removeError ? { message: 'delete failed' } : null }));
  const insert = vi.fn(async () => ({ error: options?.insertError ? { message: 'metadata failed' } : null }));
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      lte: vi.fn(() => ({
        limit: vi.fn(async () => ({ data: options?.expired ?? [], error: null }))
      }))
    }))
  }));

  return {
    storage: {
      getBucket: vi.fn(async () => ({ data: options?.bucket === undefined ? { id: 'temporary-attachments', public: false } : options.bucket, error: null })),
      from: vi.fn(() => ({ upload, remove }))
    },
    from: vi.fn(() => ({ insert, update, select })),
    upload,
    remove,
    insert,
    update
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

  test('stores validated bytes under an opaque key with durable metadata', async () => {
    const client = makeClient();
    const result = await storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile() });

    expect(result).toMatchObject({ status: 'stored', mimeType: 'application/pdf' });
    expect(result.objectKey).toMatch(new RegExp(`^${sessionId}/[0-9a-f-]{36}$`));
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

  test('removes the uploaded object when metadata persistence fails', async () => {
    const client = makeClient({ insertError: true });

    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile() }))
      .rejects.toMatchObject({ code: 'private_storage_metadata_failed' });
    expect(client.remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${sessionId}/[0-9a-f-]{36}$`))]);
  });

  test('never logs the original filename', async () => {
    const client = makeClient({ insertError: true });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(storePrivateUpload({ client: client as never, bucket: 'temporary-attachments', sessionId, file: makeFile('private-budget.pdf') })).rejects.toBeDefined();
    expect(JSON.stringify(spy.mock.calls)).not.toContain('private-budget.pdf');
  });

  test('deletes expired objects before marking them expired', async () => {
    const client = makeClient({ expired: [{ id: 'file-1', object_key: `${sessionId}/0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c` }] });

    await expect(cleanupExpiredStoredUploads(client as never, 'temporary-attachments')).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(client.remove).toHaveBeenCalledWith([`${sessionId}/0d8db2ac-03b2-414b-bf9b-8cf2f6fcd80c`]);
    expect(client.update).toHaveBeenCalledWith({ status: 'expired' });
  });
});
