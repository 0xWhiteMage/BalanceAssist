import type { SupabaseServerClient } from '@/lib/supabase/server';

export function mediaBucketFromEnv(): string | null {
  const bucket = process.env.SUPABASE_PRIVATE_MEDIA_BUCKET?.trim()
    || process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET?.trim();
  return bucket && /^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket) ? bucket : null;
}

export async function privateMediaBucketAvailable(client: SupabaseServerClient, bucket: string): Promise<boolean> {
  const { data, error } = await client.storage.getBucket(bucket);
  if (error || data?.id !== bucket || data.public !== false) return false;
  const attestation = await client.rpc('private_media_storage_is_ready', { p_bucket: bucket });
  return !attestation.error && attestation.data === true;
}

export async function inspectPrivateMediaObject(
  client: SupabaseServerClient,
  bucket: string,
  objectKey: string
): Promise<{ sizeBytes: number; mimeType: string } | null> {
  const slash = objectKey.lastIndexOf('/');
  if (slash < 1 || slash === objectKey.length - 1) return null;
  const directory = objectKey.slice(0, slash);
  const name = objectKey.slice(slash + 1);
  const { data, error } = await client.storage.from(bucket).list(directory, {
    limit: 2,
    search: name
  });
  if (error) return null;
  const object = data?.find((candidate) => candidate.name === name);
  const metadata = object?.metadata as { size?: unknown; mimetype?: unknown } | null;
  if (!metadata || !Number.isSafeInteger(metadata.size) || typeof metadata.mimetype !== 'string') return null;
  return { sizeBytes: Number(metadata.size), mimeType: metadata.mimetype.split(';', 1)[0].toLowerCase() };
}
