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

  const requestedAt = new Date().toISOString();

  const { error } = await session.supabase
    .from('events')
    .insert({
      session_id: sessionId,
      event_name: 'deletion_requested',
      properties: {
        requestedAt,
        source: 'api/projects/delete'
      }
    });

  if (error) {
    return jsonWithCors({ error: 'project_delete_failed' }, { status: 500 });
  }

  emitEvent('deletion_requested', { sessionId }, requestId);

  logger.info('Deletion requested', { sessionId, requestedAt });

  return jsonWithCors({
    ok: true,
    sessionId,
    deleted: false,
    status: 'requested',
    message:
      'We recorded your deletion request. This endpoint does not automatically erase Telegram messages, backups, or other downstream copies.',
    requestedAt
  });
}
