import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { MEDIA_THUMBNAIL_URL_SECONDS, mediaJobIdSchema } from '@/lib/media/contracts';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await requireSession(request);
  if (!session.ok) return session.response;
  const { jobId } = await context.params;
  if (!mediaJobIdSchema.safeParse(jobId).success) return jsonWithCors({ ok: false, code: 'invalid_media_job_id' }, { status: 400 }, request);
  const query = await session.supabase.from('media_derivatives')
    .select('bucket, object_key, media_processing_jobs!inner(session_id, state, expires_at)')
    .eq('job_id', jobId)
    .eq('kind', 'thumbnail')
    .eq('media_processing_jobs.session_id', session.auth.sessionId)
    .eq('media_processing_jobs.state', 'succeeded')
    .gt('media_processing_jobs.expires_at', new Date().toISOString())
    .maybeSingle();
  const derivative = query.data as { bucket: string; object_key: string } | null;
  if (query.error || !derivative) return jsonWithCors({ ok: false, code: 'media_thumbnail_not_found' }, { status: 404 }, request);
  const signed = await session.supabase.storage.from(derivative.bucket).createSignedUrl(derivative.object_key, MEDIA_THUMBNAIL_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) return jsonWithCors({ ok: false, code: 'media_thumbnail_unavailable' }, { status: 503 }, request);
  return jsonWithCors({ ok: true, url: signed.data.signedUrl, expiresInSeconds: MEDIA_THUMBNAIL_URL_SECONDS }, { headers: { 'Cache-Control': 'private, no-store' } }, request);
}
