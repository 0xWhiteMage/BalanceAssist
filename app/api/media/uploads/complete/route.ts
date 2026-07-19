import { corsOptionsResponse, jsonWithCors, readJsonBodyLimited } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { MEDIA_API_BODY_MAX_BYTES, mediaUploadCompleteSchema } from '@/lib/media/contracts';
import { inspectPrivateMediaObject } from '@/lib/media/private-storage';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session.ok) return session.response;
  const body = await readJsonBodyLimited(request, MEDIA_API_BODY_MAX_BYTES);
  if (!body.ok) return jsonWithCors({ ok: false, code: body.tooLarge ? 'payload_too_large' : 'invalid_json' }, { status: body.tooLarge ? 413 : 400 }, request);
  const parsed = mediaUploadCompleteSchema.safeParse(body.data);
  if (!parsed.success) return jsonWithCors({ ok: false, code: 'invalid_media_completion' }, { status: 400 }, request);

  const lookup = await session.supabase.from('media_processing_jobs')
    .select('id, source_bucket, source_object_key, declared_size_bytes, declared_mime_type, state')
    .eq('id', parsed.data.jobId)
    .eq('session_id', session.auth.sessionId)
    .maybeSingle();
  const job = lookup.data as {
    id: string;
    source_bucket: string;
    source_object_key: string;
    declared_size_bytes: number;
    declared_mime_type: string;
    state: string;
  } | null;
  if (lookup.error || !job) return jsonWithCors({ ok: false, code: 'media_job_not_found' }, { status: 404 }, request);
  if (job.state !== 'awaiting_upload') return jsonWithCors({ ok: false, code: 'media_job_not_awaiting_upload' }, { status: 409 }, request);

  const object = await inspectPrivateMediaObject(session.supabase, job.source_bucket, job.source_object_key);
  if (!object || object.sizeBytes !== Number(job.declared_size_bytes) || object.mimeType !== job.declared_mime_type) {
    await session.supabase.rpc('cancel_media_processing_job', { p_job_id: job.id, p_reason: 'uploaded_object_mismatch' });
    if (object) await session.supabase.storage.from(job.source_bucket).remove([job.source_object_key]);
    return jsonWithCors({ ok: false, code: 'uploaded_object_mismatch' }, { status: 422 }, request);
  }

  const finalized = await session.supabase.rpc('finalize_media_upload', {
    p_job_id: job.id,
    p_session_id: session.auth.sessionId,
    p_actual_size_bytes: object.sizeBytes,
    p_actual_mime_type: object.mimeType
  });
  if (finalized.error || finalized.data !== true) {
    await session.supabase.rpc('cancel_media_processing_job', { p_job_id: job.id, p_reason: 'upload_finalize_failed' });
    await session.supabase.storage.from(job.source_bucket).remove([job.source_object_key]);
    return jsonWithCors({ ok: false, code: 'media_upload_not_finalized' }, { status: 409 }, request);
  }
  return jsonWithCors({ ok: true, jobId: job.id, state: 'queued' }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } }, request);
}
