import { finalizeLeadPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const requestedSessionId = await request.clone().json()
    .then((body: unknown) => (
      typeof body === 'object' && body !== null && typeof (body as { sessionId?: unknown }).sessionId === 'string'
        ? (body as { sessionId: string }).sessionId
        : undefined
    ))
    .catch(() => undefined);

  const authResult = await requireSession(request, requestedSessionId);
  if (!authResult.ok) return authResult.response;

  const parsed = await parseRequestBody(request, finalizeLeadPayloadSchema);
  if (!parsed.ok) return parsed.response;

  const { sessionId } = parsed.data;

  const { data, error } = await authResult.supabase.rpc('finalize_session_lead', {
    p_session_id: sessionId
  });
  const result = Array.isArray(data) ? data[0] as {
    persisted?: boolean;
    consent_required?: boolean;
    qualification_status?: string | null;
    score?: number | null;
    recommended_next_step?: string | null;
    handoff_id?: string | null;
    crm_record_id?: string | null;
    crm_revision?: number | null;
    approved_draft_version?: number | null;
    crm_queued?: boolean | null;
  } : null;

  if (error || !result) {
    return jsonWithCors({ ok: false, sessionId, persisted: false, error: 'lead_finalize_failed' }, { status: 500 }, request);
  }
  if (result.consent_required) {
    return jsonWithCors({ ok: false, code: 'consent_required', sessionId, persisted: false }, { status: 403 }, request);
  }
  if (!result.persisted) {
    return jsonWithCors({ ok: true, sessionId, persisted: false, reason: 'No contact + project detail in canonical draft; skipped to keep the database clean.' }, undefined, request);
  }

  return jsonWithCors({
    ok: true,
    sessionId,
    qualificationStatus: result.qualification_status,
    score: result.score,
    recommendedNextStep: result.recommended_next_step,
    persisted: true,
    queued: Boolean(result.handoff_id),
    delivered: false,
    retryable: false,
    handoffId: result.handoff_id ?? undefined,
    crmRecordId: result.crm_record_id ?? undefined,
    crmRevision: result.crm_revision ?? undefined,
    approvedDraftVersion: result.approved_draft_version ?? undefined,
    crmQueued: Boolean(result.crm_queued)
  }, undefined, request);
}
