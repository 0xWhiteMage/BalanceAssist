import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { mediaJobIdSchema } from '@/lib/media/contracts';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await requireSession(request);
  if (!session.ok) return session.response;
  const { jobId } = await context.params;
  if (!mediaJobIdSchema.safeParse(jobId).success) return jsonWithCors({ ok: false, code: 'invalid_media_job_id' }, { status: 400 }, request);
  const query = await session.supabase.from('media_processing_jobs')
    .select('id, operation, state, attempts, result, error_code, created_at, updated_at, completed_at, expires_at, media_derivatives(id, kind, mime_type, size_bytes, width, height)')
    .eq('id', jobId)
    .eq('session_id', session.auth.sessionId)
    .maybeSingle();
  if (query.error || !query.data) return jsonWithCors({ ok: false, code: 'media_job_not_found' }, { status: 404 }, request);
  return jsonWithCors({ ok: true, job: query.data }, { headers: { 'Cache-Control': 'private, no-store' } }, request);
}
