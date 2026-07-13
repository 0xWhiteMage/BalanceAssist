import { jsonWithCors } from '@/lib/api/route-helpers';
import { SESSION_CAPABILITY_COOKIE_NAME, requireSession } from '@/lib/api/require-session';
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

  const { data, error } = await session.supabase
    .from('sessions')
    .select('draft_version')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    return jsonWithCors({ ok: false, error: error.message }, { status: 500 }, request);
  }

  if (!data) {
    return jsonWithCors({ ok: false, error: 'Session not found' }, { status: 404 }, request);
  }

  const row = data as { draft_version?: number | null };
  const nextDraftVersion = (row.draft_version ?? 0) + 1;

  const { error: updateError } = await session.supabase
    .from('sessions')
    .update({
      draft: {},
      draft_version: nextDraftVersion,
      status: 'open',
      capability_hash: null,
      capability_expires_at: null
    })
    .eq('id', sessionId);

  if (updateError) {
    return jsonWithCors({ ok: false, error: updateError.message }, { status: 500 }, request);
  }

  const response = jsonWithCors({ ok: true, reset: true, sessionId, draftVersion: nextDraftVersion }, undefined, request);
  emitEvent('project_reset', { sessionId, draftVersion: nextDraftVersion }, requestId);
  response.cookies.set({
    name: SESSION_CAPABILITY_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    expires: new Date(0)
  });
  return response;
}
