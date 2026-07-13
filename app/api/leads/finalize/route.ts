import { finalizeLeadPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { getVisibleDraftValues, normalizeVersionedDraft } from '@/lib/conversation/draft-versioning';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { ensureTelegramTopic } from '@/lib/telegram';
import { enqueueHandoff, type HandoffOutcome } from '@/lib/handoff/outbox';
import { routeLead } from '@/lib/handoff/routing';
import { buildHandoffPacket } from '@/lib/handoff/packet';
import { getSessionConsent } from '@/lib/privacy/session-consent';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

function hasSubstance(
  draft:
    | {
        service?: string;
        projectScope?: string;
        timelineBand?: string;
        budgetBand?: string;
        contactName?: string;
        contactEmail?: string;
        contactCompany?: string;
      }
    | undefined
): boolean {
  if (!draft) return false;

  const hasContact = Boolean(draft.contactEmail?.trim() || draft.contactName?.trim());
  const hasProjectDetail = Boolean(
    draft.service?.trim() ||
      draft.projectScope?.trim() ||
      draft.timelineBand?.trim() ||
      draft.budgetBand?.trim()
  );

  return hasContact && hasProjectDetail;
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, finalizeLeadPayloadSchema);
  const requestId = extractRequestId(request);
  const logger = createLogger('leads-finalize', requestId);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, qualificationStatus, score, recommendedNextStep } = parsed.data;
  const authResult = await requireSession(request, sessionId);

  if (!authResult.ok) {
    return authResult.response;
  }

  const { supabase } = authResult;

  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select('draft, draft_version, telegram_thread_id, contact_name, contact_company')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError) {
    return jsonWithCors({ ok: false, error: sessionError.message }, { status: 500 }, request);
  }

  if (!sessionRow) {
    return jsonWithCors({ ok: false, error: 'Session not found' }, { status: 404 }, request);
  }

  const row = sessionRow as {
    draft?: unknown;
    draft_version?: number | null;
    telegram_thread_id?: number | null;
    contact_name?: string | null;
    contact_company?: string | null;
  };

  const versionedDraft = normalizeVersionedDraft(row.draft);
  const visibleDraft = getVisibleDraftValues(versionedDraft);

  if (!hasSubstance(visibleDraft)) {
    emitEvent('lead_skipped', { sessionId, reason: 'no_substance' }, requestId);
    return jsonWithCors({
      ok: true,
      sessionId,
      qualificationStatus,
      persisted: false,
      reason: 'No contact + project detail in canonical draft; skipped to keep the database clean.'
    }, undefined, request);
  }

  let attachmentConsent;
  try {
    attachmentConsent = await getSessionConsent(supabase as never, sessionId);
  } catch {
    return jsonWithCors({ ok: false, sessionId, qualificationStatus, persisted: false, error: 'Consent ledger unavailable' }, { status: 500 }, request);
  }

  const canonicalDraft = {
    service: visibleDraft.service || undefined,
    projectType: visibleDraft.projectType || undefined,
    projectScope: visibleDraft.projectScope || undefined,
    scopePolished: visibleDraft.scopePolished || undefined,
    timelineBand: visibleDraft.timelineBand || undefined,
    budgetBand: visibleDraft.budgetBand || undefined,
    contactName: visibleDraft.contactName || undefined,
    contactEmail: visibleDraft.contactEmail || undefined,
    contactCompany: visibleDraft.contactCompany || undefined,
  };

  const { error } = await supabase.from('leads').insert({
    session_id: sessionId,
    qualification_status: qualificationStatus,
    score: score ?? null,
    recommended_next_step: recommendedNextStep ?? null,
    lead_draft: canonicalDraft,
    contact_name: canonicalDraft.contactName ?? null,
    contact_email: canonicalDraft.contactEmail ?? null
  });

  if (error) {
    logger.error('Failed to insert lead', { sessionId, error: error.message });
    return jsonWithCors({
      ok: false,
      sessionId,
      qualificationStatus,
      persisted: false,
      error: error.message
    }, { status: 500 }, request);
  }

  emitEvent('lead_persisted', { sessionId, qualificationStatus, score: score ?? 0 }, requestId);

  const { error: statusUpdateError } = await supabase
    .from('sessions')
    .update({ status: qualificationStatus === 'qualified' ? 'completed' : 'escalated' })
    .eq('id', sessionId);

  if (statusUpdateError) {
    return jsonWithCors({
      ok: false,
      sessionId,
      qualificationStatus,
      persisted: true,
      error: statusUpdateError.message
    }, { status: 500 }, request);
  }

  let handoffOutcome: HandoffOutcome = { persisted: true, queued: false, delivered: false, retryable: false };
  const shortId = sessionId.slice(0, 8);
  const snap = sessionRow as {
    telegram_thread_id?: number | null;
    contact_name?: string | null;
    contact_company?: string | null;
  };

  try {
    const routing = routeLead(
      {
        service: canonicalDraft.service || '',
        projectScope: canonicalDraft.projectScope || '',
        timelineBand: canonicalDraft.timelineBand || '',
        budgetBand: canonicalDraft.budgetBand || '',
        contactName: canonicalDraft.contactName || '',
        contactEmail: canonicalDraft.contactEmail || '',
        qualificationStatus,
        score: score ?? 0,
      },
      sessionId
    );

    const linkRows = attachmentConsent.producerTransfer
      ? (await supabase
          .from('reference_links')
          .select('url, kind')
          .eq('session_id', sessionId)).data
      : [];

    const fileRows = attachmentConsent.producerTransfer
      ? (await supabase
          .from('uploaded_files')
          .select('name, original_name, status, mime, mime_type')
          .eq('session_id', sessionId)).data
      : [];

    const packet = buildHandoffPacket({
      sessionId,
      caseId: routing.caseId,
      routingDestination: routing.destination,
      routingReasons: routing.reasons,
      qualificationStatus,
      score: score ?? 0,
      draft: {
        service: canonicalDraft.service,
        projectType: canonicalDraft.projectType,
        projectScope: canonicalDraft.projectScope,
        timelineBand: canonicalDraft.timelineBand,
        budgetBand: canonicalDraft.budgetBand,
        contactName: canonicalDraft.contactName,
        contactEmail: canonicalDraft.contactEmail,
        contactCompany: canonicalDraft.contactCompany,
      },
      attachments: ((fileRows ?? []) as Array<{ name?: string; original_name?: string; status?: string; mime?: string; mime_type?: string }>).map(
        (f) => ({
          originalName: f.original_name ?? f.name ?? '',
          status: f.status ?? 'unknown',
          mimeType: f.mime_type ?? f.mime
        })
      ),
      links: ((linkRows ?? []) as Array<{ url?: string; kind?: string }>).map(
        (l) => ({ url: l.url ?? '', kind: l.kind })
      ),
      consentScope: {
        aiAnalysis: attachmentConsent.analysis,
        producerShare: attachmentConsent.producerTransfer
      },
    });

    const threadId = snap.telegram_thread_id
      ? snap.telegram_thread_id
      : await ensureTelegramTopic(
          supabase,
          sessionId,
          snap.contact_name ?? canonicalDraft.contactName ?? null,
          snap.contact_company ?? canonicalDraft.contactCompany ?? null,
          shortId,
          routing.caseId
        );

    if (threadId) {
      handoffOutcome = await enqueueHandoff(supabase, {
        sessionId,
        type: 'approval',
        summary: packet.summaryText,
        threadId
      });

      if (handoffOutcome.handoffId) {
        emitEvent('handoff_enqueued', {
          sessionId,
          handoffId: handoffOutcome.handoffId,
          caseId: routing.caseId,
          routingDestination: routing.destination
        }, requestId);
      }
    }
  } catch (error) {
    logger.error('Telegram topic update failed', {
      sessionId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  return jsonWithCors({
    ok: true,
    sessionId,
    qualificationStatus,
    persisted: true,
    queued: handoffOutcome.queued,
    delivered: handoffOutcome.delivered,
    retryable: handoffOutcome.retryable,
    handoffId: handoffOutcome.handoffId
  }, undefined, request);
}
