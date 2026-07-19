import { corsOptionsResponse, jsonWithCors, readJsonBodyLimited } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import {
  MEDIA_API_BODY_MAX_BYTES,
  mediaObjectKey,
  mediaUploadIntentSchema
} from '@/lib/media/contracts';
import { mediaBucketFromEnv, privateMediaBucketAvailable } from '@/lib/media/private-storage';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session.ok) return session.response;
  const body = await readJsonBodyLimited(request, MEDIA_API_BODY_MAX_BYTES);
  if (!body.ok) return jsonWithCors({ ok: false, code: body.tooLarge ? 'payload_too_large' : 'invalid_json' }, { status: body.tooLarge ? 413 : 400 }, request);
  const parsed = mediaUploadIntentSchema.safeParse(body.data);
  if (!parsed.success) return jsonWithCors({ ok: false, code: 'invalid_media_intent' }, { status: 400 }, request);

  const bucket = mediaBucketFromEnv();
  if (!bucket) return jsonWithCors({ ok: false, code: 'private_media_unavailable' }, { status: 503 }, request);
  if (!await privateMediaBucketAvailable(session.supabase, bucket)) {
    return jsonWithCors({ ok: false, code: 'private_media_unavailable' }, { status: 503 }, request);
  }
  const objectKey = mediaObjectKey();
  const created = await session.supabase.rpc('create_media_processing_job', {
    p_session_id: session.auth.sessionId,
    p_operation: parsed.data.operation,
    p_source_bucket: bucket,
    p_source_object_key: objectKey,
    p_declared_mime_type: parsed.data.mimeType,
    p_declared_size_bytes: parsed.data.sizeBytes
  });
  const job = (Array.isArray(created.data) ? created.data[0] : created.data) as { id?: string; upload_expires_at?: string } | null;
  if (created.error || !job?.id || !job.upload_expires_at) {
    return jsonWithCors({ ok: false, code: 'media_job_unavailable' }, { status: 503 }, request);
  }

  const signed = await session.supabase.storage.from(bucket).createSignedUploadUrl(objectKey, { upsert: false });
  if (signed.error || !signed.data?.token) {
    await session.supabase.rpc('cancel_media_processing_job', { p_job_id: job.id, p_reason: 'upload_token_failed' });
    return jsonWithCors({ ok: false, code: 'media_upload_unavailable' }, { status: 503 }, request);
  }

  return jsonWithCors({
    ok: true,
    jobId: job.id,
    upload: { bucket, objectKey, token: signed.data.token },
    uploadExpiresAt: job.upload_expires_at
  }, { headers: { 'Cache-Control': 'private, no-store' } }, request);
}
