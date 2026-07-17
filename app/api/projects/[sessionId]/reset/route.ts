import { jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const requestId = extractRequestId(request);
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

  const { data, error } = await session.supabase.rpc('clear_session_draft', { p_session_id: sessionId });

  if (error) {
    return jsonWithCors({ ok: false, error: 'project_reset_failed' }, { status: 500 }, request);
  }

  const row = (Array.isArray(data) ? data[0] : data) as { draft_version?: number } | null;
  if (!row || typeof row.draft_version !== 'number') return jsonWithCors({ ok: false, error: 'project_reset_failed' }, { status: 500 }, request);
  const nextDraftVersion = row.draft_version;

  const response = jsonWithCors({
    ok: true,
    reset: true,
    sessionId,
    draftVersion: nextDraftVersion,
    message: 'Editable brief cleared. Uploads, links, consent history, approved transfers, provider copies, and backups were not deleted.'
  }, undefined, request);
  emitEvent('project_reset', { sessionId, draftVersion: nextDraftVersion }, requestId);
  return response;
}
