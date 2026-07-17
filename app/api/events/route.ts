import { eventPayloadSchema } from '@/lib/api/contracts';
import { requireSession } from '@/lib/api/require-session';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';

const ALLOWED_EVENT_NAMES = new Set([
  'widget_closed',
  'human_handoff',
  'step_advanced',
  'llm_request',
  'deletion_requested',
  'memory_inspected',
  'memory_reset_requested',
  'memory_correction_requested'
]);

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, eventPayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, eventName, properties } = parsed.data;

  if (!ALLOWED_EVENT_NAMES.has(eventName)) {
    return jsonWithCors({ ok: false, error: 'Unknown event name' }, { status: 400 }, request);
  }

  const authResult = await requireSession(request, sessionId);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { supabase } = authResult;

  const { error } = await supabase
    .from('events')
    .insert({ session_id: sessionId, event_name: eventName, properties: properties ?? null });

  if (error) {
    return jsonWithCors({ ok: false, error: 'event_persist_failed' }, { status: 500 }, request);
  }

  return jsonWithCors({ ok: true, eventName });
}
