import { finalizeLeadPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { editForumTopic, sendTelegramMessage } from '@/lib/telegram';
import { buildTopicName, TOPIC_STATUS_COLOR, topicStatusFromQualification } from '@/lib/conversation/topic-status';

export async function OPTIONS() {
  return corsOptionsResponse();
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

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, qualificationStatus, score, recommendedNextStep, leadDraft } = parsed.data;

  if (!hasSubstance(leadDraft)) {
    return jsonWithCors({
      ok: true,
      sessionId,
      qualificationStatus,
      persisted: false,
      reason: 'No contact + project detail; skipped to keep the database clean.'
    });
  }

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({
      ok: true,
      sessionId,
      qualificationStatus,
      persisted: false,
      reason: 'Supabase not configured.'
    });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return jsonWithCors({
      ok: true,
      sessionId,
      qualificationStatus,
      persisted: false,
      reason: 'Supabase client failed.'
    });
  }

  const { error } = await supabase.from('leads').insert({
    session_id: sessionId,
    qualification_status: qualificationStatus,
    score: score ?? null,
    recommended_next_step: recommendedNextStep ?? null,
    lead_draft: leadDraft ?? null,
    contact_name: leadDraft?.contactName ?? null,
    contact_email: leadDraft?.contactEmail ?? null
  });

  if (error) {
    console.error('[leads-finalize] Failed to insert lead', { sessionId, error });
    return jsonWithCors({
      ok: true,
      sessionId,
      qualificationStatus,
      persisted: false,
      reason: error.message
    });
  }

  await supabase
    .from('sessions')
    .update({ status: qualificationStatus === 'qualified' ? 'completed' : 'escalated' })
    .eq('id', sessionId);

  try {
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('telegram_thread_id, contact_name, contact_company')
      .eq('id', sessionId)
      .maybeSingle();

    const snap = sessionRow as {
      telegram_thread_id?: number | null;
      contact_name?: string | null;
      contact_company?: string | null;
    } | null;

    if (snap?.telegram_thread_id) {
      const shortId = sessionId.slice(0, 8);
      const topicStatus = topicStatusFromQualification(qualificationStatus);
      const name = buildTopicName(
        snap.contact_name ?? leadDraft?.contactName ?? null,
        snap.contact_company ?? leadDraft?.contactCompany ?? null,
        shortId,
        topicStatus
      );

      const updated = await editForumTopic(snap.telegram_thread_id, name, {
        iconColor: TOPIC_STATUS_COLOR[topicStatus]
      });

      if (updated) {
        console.log('[leads-finalize] Renamed topic on finalize', {
          sessionId,
          threadId: snap.telegram_thread_id,
          name,
          topicStatus
        });
      } else {
        console.warn('[leads-finalize] editForumTopic failed', { sessionId });
      }

      const referenceLinks = Array.isArray(leadDraft?.referenceLinks) ? leadDraft.referenceLinks : [];
      const referenceFiles = Array.isArray(leadDraft?.referenceFiles) ? leadDraft.referenceFiles : [];
      const linkLines = referenceLinks
        .filter((value): value is { kind?: string; url?: string } => Boolean(value) && typeof value === 'object')
        .map((link) => `• Link (${link.kind ?? 'other'}): ${link.url ?? ''}`);
      const fileLines = referenceFiles
        .filter((value): value is { name?: string } => Boolean(value) && typeof value === 'object')
        .map((file) => `• File: ${file.name ?? ''}`);

      if (linkLines.length || fileLines.length) {
        const body = ['Attachments:', ...linkLines, ...fileLines].join('\n');
        try {
          await sendTelegramMessage(body, { threadId: snap.telegram_thread_id });
        } catch (error) {
          console.warn('[leads-finalize] failed to send attachment summary', { sessionId, error });
        }
      }
    }
  } catch (error) {
    console.error('[leads-finalize] Telegram topic update failed', { sessionId, error });
  }

  return jsonWithCors({
    ok: true,
    sessionId,
    qualificationStatus,
    persisted: true
  });
}