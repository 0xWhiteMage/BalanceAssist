import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { extractRequestId } from '@/lib/logger';

const relayPayloadSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000)
});

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, relayPayloadSchema);
  if (!parsed.ok) return parsed.response;
  const { sessionId, text } = parsed.data;
  const authResult = await requireSession(request, sessionId);
  if (!authResult.ok) return authResult.response;
  const requestId = extractRequestId(request)?.trim();
  if (!requestId) return jsonWithCors({ ok: false, error: 'request_id_required' }, { status: 400 }, request);

  const { data, error } = await authResult.supabase.rpc('relay_human_message', {
    p_session_id: sessionId,
    p_request_id: requestId,
    p_text: text
  });
  const result = Array.isArray(data) ? data[0] as {
    persisted?: boolean; consent_required?: boolean; handoff_id?: string | null;
  } : null;
  if (error || !result) return jsonWithCors({ ok: false, error: 'relay_persist_failed' }, { status: 500 }, request);
  if (result.consent_required) return jsonWithCors({ ok: false, code: 'consent_required' }, { status: 403 }, request);

  return jsonWithCors({
    ok: result.persisted === true,
    persisted: result.persisted === true,
    queued: Boolean(result.handoff_id)
  }, undefined, request);
}
