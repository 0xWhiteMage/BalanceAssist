import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { CONSENT_VERSION } from '@/lib/privacy/notice';
import { getSessionConsent } from '@/lib/privacy/session-consent';

const transitionSchema = z.object({
  scope: z.enum(['analysis', 'producer_transfer']),
  granted: z.boolean(),
  noticeVersion: z.string().min(1)
});

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ ok: false, code: 'INVALID_CONSENT_REQUEST' }, { status: 400 }, request);
  }

  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonWithCors({ ok: false, code: 'INVALID_CONSENT_REQUEST' }, { status: 400 }, request);
  }
  if (parsed.data.noticeVersion !== CONSENT_VERSION) {
    return jsonWithCors({ ok: false, code: 'UNSUPPORTED_NOTICE_VERSION' }, { status: 400 }, request);
  }

  const authResult = await requireSession(request, sessionId);
  if (!authResult.ok) {
    return jsonWithCors({ ok: false, code: 'SESSION_AUTHORIZATION_FAILED' }, { status: authResult.response.status }, request);
  }

  const { error } = await authResult.supabase.from('session_consents').insert({
    session_id: authResult.auth.sessionId,
    scope: parsed.data.scope,
    granted: parsed.data.granted,
    notice_version: parsed.data.noticeVersion,
    provenance: 'session_capability'
  });
  if (error) {
    return jsonWithCors({ ok: false, code: 'CONSENT_PERSISTENCE_FAILED' }, { status: 500 }, request);
  }

  try {
    const consent = await getSessionConsent(authResult.supabase as never, authResult.auth.sessionId);
    return jsonWithCors({ ok: true, consent }, undefined, request);
  } catch {
    return jsonWithCors({ ok: false, code: 'CONSENT_PERSISTENCE_FAILED' }, { status: 500 }, request);
  }
}
