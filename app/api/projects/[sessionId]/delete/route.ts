import { jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const requestId = extractRequestId(request);
  const logger = createLogger('project-delete', requestId);
  const { sessionId } = await params;

  if (!sessionId || typeof sessionId !== 'string') {
    return jsonWithCors({ error: 'Invalid session ID' }, { status: 400 });
  }

  const session = await requireSession(request);
  if (!session.ok) {
    return session.response;
  }

  if (session.auth.sessionId !== sessionId) {
    return jsonWithCors({ error: 'Session mismatch' }, { status: 403 });
  }

  const { data: job, error } = await session.supabase
    .from('deletion_jobs')
    .upsert({ session_id: sessionId, state: 'requested' }, { onConflict: 'session_id', ignoreDuplicates: true })
    .select('id, state, requested_at, attempts')
    .single();

  if (error) {
    return jsonWithCors({ error: 'project_delete_failed' }, { status: 500 });
  }

  const requestedAt = job.requested_at;
  emitEvent('deletion_requested', {}, requestId);

  logger.info('Deletion requested', { jobId: job.id, state: job.state });

  return jsonWithCors({
    ok: true,
    sessionId,
    jobId: job.id,
    deleted: false,
    status: job.state,
    message:
      'We recorded your deletion request. This endpoint does not automatically erase Telegram messages, backups, or other downstream copies.',
    requestedAt
  });
}
