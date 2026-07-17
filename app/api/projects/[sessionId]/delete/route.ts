import { createHash } from 'node:crypto';
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

  const receiptSecret = createHash('sha256')
    .update(`balance-assist-deletion-receipt:${session.auth.capability}`)
    .digest('base64url');
  const receiptHash = createHash('sha256').update(receiptSecret).digest('hex');
  const { data, error } = await session.supabase.rpc('request_session_deletion', {
    p_session_id: sessionId,
    p_receipt_hash: receiptHash
  });
  const row = Array.isArray(data) ? data[0] : data;
  const job = row as {
    receipt_id: string;
    status: string;
    requested_at: string;
    updated_at: string;
    completed_at?: string | null;
    failed_at?: string | null;
  } | null;

  if (error || !job) {
    return jsonWithCors({ error: 'project_delete_failed' }, { status: 500 });
  }

  const requestedAt = job.requested_at;
  emitEvent('deletion_requested', { sessionId }, requestId);

  logger.info('Deletion requested', { state: job.status });

  return jsonWithCors({
    ok: true,
    sessionId,
    receipt: `${job.receipt_id}.${receiptSecret}`,
    receiptId: job.receipt_id,
    deleted: false,
    status: job.status,
    message: 'We recorded your deletion request. Work already reserved with a provider may still complete. Telegram messages, backups, and other downstream copies have separate retention controls.',
    requestedAt,
    updatedAt: job.updated_at,
    completedAt: job.completed_at ?? null,
    failedAt: job.failed_at ?? null
  }, { headers: { 'Cache-Control': 'no-store, private' } }, request);
}
