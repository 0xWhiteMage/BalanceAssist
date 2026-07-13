import { createHash, randomUUID } from 'crypto';
import { temporaryDraftExpiry } from '@/lib/privacy/session-retention';
import { validateFile } from '@/lib/uploads/quarantine';

export type PrivateStorageClient = {
  storage: {
    getBucket: (bucket: string) => Promise<{ data: { id: string; public: boolean } | null; error: unknown }>;
    from: (bucket: string) => {
      upload: (path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }) => Promise<{ error: { message?: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message?: string } | null }>;
    };
  };
  from: (table: 'uploaded_files') => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        lte: (column: string, value: string) => {
          limit: (count: number) => PromiseLike<{ data: Array<{ id: string; object_key: string }> | null; error: { message?: string } | null }>;
        };
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: { message?: string } | null }>;
    };
  };
};

export class PrivateStorageError extends Error {
  constructor(public readonly code: 'private_storage_unavailable' | 'private_storage_upload_failed' | 'private_storage_metadata_failed') {
    super(code);
  }
}

export function privateUploadBucketFromEnv(): string | null {
  const bucket = process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET?.trim();
  return bucket && /^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket) ? bucket : null;
}

export async function privateStorageAvailable(client: PrivateStorageClient, bucket: string): Promise<boolean> {
  const { data, error } = await client.storage.getBucket(bucket);
  return !error && data?.id === bucket && data.public === false;
}

export async function storePrivateUpload(input: { client: PrivateStorageClient; bucket: string; sessionId: string; file: File }) {
  if (!await privateStorageAvailable(input.client, input.bucket)) {
    throw new PrivateStorageError('private_storage_unavailable');
  }

  const source = typeof input.file.arrayBuffer === 'function'
    ? await input.file.arrayBuffer()
    : await new Response(input.file).arrayBuffer();
  const bytes = new Uint8Array(source);
  const validation = validateFile(input.file, bytes.buffer);
  if (!validation.ok) {
    throw new PrivateStorageError('private_storage_upload_failed');
  }

  const objectKey = `${input.sessionId}/${randomUUID()}`;
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const retentionExpiresAt = temporaryDraftExpiry().toISOString();
  const storage = input.client.storage.from(input.bucket);
  const uploaded = await storage.upload(objectKey, bytes, { contentType: validation.mime, upsert: false });
  if (uploaded.error) {
    throw new PrivateStorageError('private_storage_upload_failed');
  }

  const metadata = await input.client.from('uploaded_files').insert({
    session_id: input.sessionId,
    object_key: objectKey,
    checksum_sha256: checksum,
    retention_expires_at: retentionExpiresAt,
    status: 'stored',
    idempotency_key: randomUUID(),
    mime_type: validation.mime,
    size_bytes: bytes.byteLength
  });
  if (metadata.error) {
    await storage.remove([objectKey]);
    throw new PrivateStorageError('private_storage_metadata_failed');
  }

  return { status: 'stored' as const, objectKey, mimeType: validation.mime, retentionExpiresAt };
}

export async function cleanupExpiredStoredUploads(client: PrivateStorageClient, bucket: string, limit = 100) {
  const expired = await client.from('uploaded_files').select('id, object_key').eq('status', 'stored').lte('retention_expires_at', new Date().toISOString()).limit(limit);
  if (expired.error) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;
  const storage = client.storage.from(bucket);
  for (const file of expired.data ?? []) {
    const removed = await storage.remove([file.object_key]);
    if (removed.error) {
      failed++;
      continue;
    }
    const marked = await client.from('uploaded_files').update({ status: 'expired' }).eq('id', file.id);
    if (marked.error) {
      failed++;
      continue;
    }
    deleted++;
  }
  return { deleted, failed };
}
