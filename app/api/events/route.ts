import { eventPayloadSchema, MAX_EVENT_BODY_BYTES } from '@/lib/api/contracts';
import { requireSession } from '@/lib/api/require-session';
import { corsOptionsResponse, jsonWithCors, readJsonBodyLimited } from '@/lib/api/route-helpers';
import { extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const body = await readJsonBodyLimited(request, MAX_EVENT_BODY_BYTES);
  if (!body.ok) {
    return jsonWithCors(
      { ok: false, error: body.tooLarge ? 'Event payload too large' : 'Invalid JSON body' },
      { status: body.tooLarge ? 413 : 400 },
      request
    );
  }
  const parsed = eventPayloadSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonWithCors({ ok: false, error: 'Invalid event payload' }, { status: 400 }, request);
  }
  const { sessionId, eventName } = parsed.data;
  const properties = 'properties' in parsed.data ? parsed.data.properties : undefined;

  const authResult = await requireSession(request, sessionId);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { supabase } = authResult;

  const { data: sessionState, error: sessionStateError } = await supabase
    .from('sessions')
    .select('deletion_state')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionStateError || !sessionState || (sessionState as { deletion_state?: string }).deletion_state !== 'active') {
    return jsonWithCors({ ok: false, error: 'event_session_inactive' }, { status: 409 }, request);
  }

  const { error } = await supabase
    .from('events')
    .insert({ session_id: sessionId, event_name: eventName, properties: properties ?? null });

  if (error?.code === 'P0001' && error.message?.includes('session_unavailable')) {
    return jsonWithCors({ ok: false, error: 'event_session_inactive' }, { status: 409 }, request);
  }
  if (error) {
    return jsonWithCors({ ok: false, error: 'event_persist_failed' }, { status: 500 }, request);
  }

  emitEvent(eventName, { sessionId, ...(properties ?? {}) }, extractRequestId(request));
  return jsonWithCors({ ok: true, eventName }, undefined, request);
}
