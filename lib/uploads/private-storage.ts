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
  from: (table: 'uploaded_files' | 'private_attachment_cleanup' | 'private_attachment_storage_readiness') => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        lte: (column: string, value: string) => {
          limit: (count: number) => PromiseLike<{ data: Array<{ id?: string; object_key: string; session_id?: string; bucket?: string; cleanup_required_at?: string | null }> | null; error: { message?: string } | null }>;
        };
        maybeSingle: () => PromiseLike<{ data: { status?: string } | null; error: unknown }>;
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: { message?: string } | null }>;
    };
    delete: () => {
      eq: (column: string, value: string) => PromiseLike<{ error: { message?: string } | null }>;
    };
  };
};

export class PrivateStorageError extends Error {
  constructor(public readonly code: 'private_storage_unavailable' | 'private_storage_upload_failed' | 'private_storage_metadata_failed' | 'private_storage_recovery_unavailable') {
    super(code);
  }
}

export function privateUploadBucketFromEnv(): string | null {
  const bucket = process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET?.trim();
  return bucket && /^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket) ? bucket : null;
}

export async function privateStorageAvailable(client: PrivateStorageClient, bucket: string): Promise<boolean> {
  const { data, error } = await client.storage.getBucket(bucket);
  if (error || data?.id !== bucket || data.public !== false) return false;
  const readiness = await client.from('private_attachment_storage_readiness').select('status').eq('bucket', bucket).maybeSingle();
  return !readiness.error && readiness.data?.status === 'ready';
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

  const objectKey = randomUUID();
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const retentionExpiresAt = temporaryDraftExpiry().toISOString();
  // Reserve recovery before creating an object so a failed rollback cannot orphan it.
  const cleanup = await input.client.from('private_attachment_cleanup').insert({
    bucket: input.bucket,
    object_key: objectKey,
    checksum_sha256: checksum,
    retention_expires_at: retentionExpiresAt,
    status: 'pending_cleanup'
  });
  if (cleanup.error) {
    throw new PrivateStorageError('private_storage_recovery_unavailable');
  }
  const storage = input.client.storage.from(input.bucket);
  const uploaded = await storage.upload(objectKey, bytes, { contentType: validation.mime, upsert: false });
  if (uploaded.error) {
    await input.client.from('private_attachment_cleanup').delete().eq('object_key', objectKey);
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
    const rollback = await storage.remove([objectKey]);
    if (!rollback.error) {
      await input.client.from('private_attachment_cleanup').delete().eq('object_key', objectKey);
    }
    throw new PrivateStorageError('private_storage_metadata_failed');
  }

  await input.client.from('private_attachment_cleanup').delete().eq('object_key', objectKey);

  return { status: 'stored' as const, objectKey, mimeType: validation.mime, retentionExpiresAt };
}

export async function cleanupExpiredStoredUploads(client: PrivateStorageClient, bucket: string, limit = 100) {
  const expired = await client.from('uploaded_files').select('id, object_key, session_id, cleanup_required_at').eq('status', 'stored').lte('retention_expires_at', new Date().toISOString()).limit(limit);
  if (expired.error) return { deleted: 0, failed: 1, deferredSessionIds: [] as string[], complete: false };

  let deleted = 0;
  let failed = 0;
  const deferredSessionIds = new Set<string>();
  let complete = (expired.data?.length ?? 0) < limit;
  const storage = client.storage.from(bucket);
  for (const file of expired.data ?? []) {
    const removed = await storage.remove([file.object_key]);
    if (removed.error) {
      failed++;
      if (file.session_id) deferredSessionIds.add(file.session_id);
      else complete = false;
      continue;
    }
    if (!file.id) {
      failed++;
      if (file.session_id) deferredSessionIds.add(file.session_id);
      else complete = false;
      continue;
    }
    const marked = file.cleanup_required_at
      ? await client.from('uploaded_files').delete().eq('id', file.id)
      : await client.from('uploaded_files').update({ status: 'expired' }).eq('id', file.id);
    if (marked.error) {
      failed++;
      if (file.session_id) deferredSessionIds.add(file.session_id);
      else complete = false;
      continue;
    }
    deleted++;
  }

  const orphaned = await client.from('private_attachment_cleanup').select('object_key, bucket').eq('status', 'pending_cleanup').lte('retention_expires_at', new Date().toISOString()).limit(limit);
  if (orphaned.error) return { deleted, failed: failed + 1, deferredSessionIds: [...deferredSessionIds], complete: false };
  if ((orphaned.data?.length ?? 0) >= limit) complete = false;
  for (const record of orphaned.data ?? []) {
    if (record.bucket !== bucket) continue;
    const removed = await storage.remove([record.object_key]);
    if (removed.error) {
      failed++;
      complete = false;
      continue;
    }
    const cleared = await client.from('private_attachment_cleanup').delete().eq('object_key', record.object_key);
    if (cleared.error) {
      failed++;
      complete = false;
      continue;
    }
    deleted++;
  }
  return { deleted, failed, deferredSessionIds: [...deferredSessionIds], complete };
}
