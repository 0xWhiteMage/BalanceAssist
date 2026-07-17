import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { CONSENT_VERSION } from '@/lib/privacy/notice';

const transitionSchema = z.object({
  scope: z.enum(['analysis', 'human_contact', 'producer_transfer']),
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

  const { data, error } = await authResult.supabase.rpc('record_session_consent', {
    p_session_id: authResult.auth.sessionId,
    p_scope: parsed.data.scope,
    p_granted: parsed.data.granted,
    p_notice_version: parsed.data.noticeVersion
  });
  if (error) {
    if (error.message?.includes('SESSION_DELETION_REQUESTED')) {
      return jsonWithCors({ ok: false, code: 'SESSION_DELETION_REQUESTED' }, { status: 409 }, request);
    }
    return jsonWithCors({ ok: false, code: 'CONSENT_PERSISTENCE_FAILED' }, { status: 500 }, request);
  }

  const state = (Array.isArray(data) ? data[0] : data) as { analysis?: boolean; human_contact?: boolean; producer_transfer?: boolean } | null;
  return jsonWithCors({ ok: true, consent: {
    analysis: state?.analysis === true,
    humanContact: state?.human_contact === true,
    producerTransfer: state?.producer_transfer === true
  } }, undefined, request);
}
