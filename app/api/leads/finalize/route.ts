import { finalizeLeadPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { isConsent12CutoverActive } from '@/lib/api/consent-cutover';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const authResult = await requireSession(request);
  if (!authResult.ok) return authResult.response;

  const parsed = await parseRequestBody(request, finalizeLeadPayloadSchema);
  if (!parsed.ok) return parsed.response;

  const { sessionId } = parsed.data;
  if (sessionId !== authResult.auth.sessionId) {
    return jsonWithCors({ error: 'Session mismatch' }, { status: 403 }, request);
  }

  if (!await isConsent12CutoverActive(authResult.supabase)) {
    return jsonWithCors({ ok: false, sessionId, persisted: false, retryable: true, error: 'consent_cutover_pending' }, { status: 503 }, request);
  }

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
    approval_input_hash?: string | null;
    approved_reference_set_hash?: string | null;
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
  if (
    typeof result.approved_draft_version !== 'number' ||
    typeof result.approval_input_hash !== 'string' ||
    typeof result.approved_reference_set_hash !== 'string'
  ) {
    return jsonWithCors(
      { ok: false, sessionId, persisted: false, retryable: true, error: 'lead_finalize_failed' },
      { status: 500 },
      request
    );
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
    approvedDraftVersion: result.approved_draft_version,
    crmQueued: Boolean(result.crm_queued),
    approvalInputHash: result.approval_input_hash,
    approvedReferenceSetHash: result.approved_reference_set_hash
  }, undefined, request);
}
