import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { editForumTopic, ensureTelegramTopic, sendTelegramMessage } from '@/lib/telegram';
import { buildTopicName, TOPIC_STATUS_COLOR } from '@/lib/conversation/topic-status';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { getSessionConsent } from '@/lib/privacy/session-consent';

const relayPayloadSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000)
});

function detectName(text: string): string | null {
  const m = text.match(/(?:i am|i'm|my name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
  if (m?.[1]) return m[1].trim();
  const trimmed = text.trim();
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(trimmed)) return trimmed;
  return null;
}

function detectCompany(text: string): string | null {
  const patterns = [
    /(?:from|at|for|with)\s+([A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,3})\b/,
    /\b([A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,2})\s+(?:Inc|Corp|Ltd|LLC|Pvt|Pte|Co|Studio|Studios|Group|Agency|Lab)\b/,
    /(?:i\s+(?:work|am)\s+(?:at|with|for))\s+([A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,3})/
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) {
      const cleaned = m[1].trim();
      if (cleaned.length >= 2 && !/^(I|My|Me|You|We|They|The|This|That|It|At|From|With|And|Or|But)$/i.test(cleaned)) {
        return cleaned;
      }
    }
  }
  return null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildMessageHtml(text: string, contactName: string | null, contactCompany: string | null, shortId: string): string {
  const sender = [contactName, contactCompany].filter(Boolean).join(' · ') || 'Anonymous';

  return [
    `<b>📨 ${escapeHtml(sender)}</b>`,
    '',
    `<blockquote>${escapeHtml(text)}</blockquote>`,
    '',
    `<code>${shortId}</code>`
  ].join('\n');
}

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const requestId = extractRequestId(request);
  const logger = createLogger('telegram-relay', requestId);
  const parsed = await parseRequestBody(request, relayPayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, text } = parsed.data;
  const authResult = await requireSession(request, sessionId);

  if (!authResult.ok) {
    return authResult.response;
  }

  const { supabase } = authResult;
  let consent;
  try {
    consent = await getSessionConsent(supabase as never, sessionId);
  } catch {
    return jsonWithCors({ ok: false, error: 'Consent ledger unavailable' }, { status: 500 }, request);
  }

  if (!consent.producerTransfer) {
    return jsonWithCors(
      { ok: false, code: 'consent_required' },
      { status: 403 },
      request
    );
  }

  const shortId = sessionId.slice(0, 8);

  const detectedName = detectName(text);
  const detectedCompany = detectCompany(text);

  const { data: existingRow, error: fetchError } = await supabase
    .from('sessions')
    .select('telegram_thread_id, contact_name, contact_company')
    .eq('id', sessionId)
    .maybeSingle();

  if (fetchError) {
    logger.error('Failed to fetch session', {
      sessionId,
      fetchError: fetchError.message ?? fetchError
    });
  }

  type SessionSnapshot = {
    telegram_thread_id?: number | null;
    contact_name?: string | null;
    contact_company?: string | null;
  };

  const sessionSnap = existingRow as SessionSnapshot | null;
  let threadId = sessionSnap?.telegram_thread_id ?? null;
  let contactName = sessionSnap?.contact_name ?? null;
  let contactCompany = sessionSnap?.contact_company ?? null;

  const detectedUpdates: Record<string, unknown> = {};
  if (detectedName && !contactName) {
    contactName = detectedName;
    detectedUpdates.contact_name = contactName;
  }
  if (detectedCompany && !contactCompany) {
    contactCompany = detectedCompany;
    detectedUpdates.contact_company = contactCompany;
  }

  const newTopicName = buildTopicName(contactName, contactCompany, shortId, 'new');
  const shouldRename = !threadId
    || (contactName && contactName !== sessionSnap?.contact_name)
    || (contactCompany && contactCompany !== sessionSnap?.contact_company);

  if (sessionSnap && !threadId) {
    const created = await ensureTelegramTopic(supabase, sessionId, contactName, contactCompany, shortId);
    if (created) {
      threadId = created;
      logger.info('Created topic', { sessionId, threadId });
    } else {
      logger.warn('createForumTopic failed; falling back to flat message', { sessionId });
    }
  } else if (threadId && shouldRename) {
    const updated = await editForumTopic(threadId, newTopicName, { iconColor: TOPIC_STATUS_COLOR.new });
    if (updated) {
      logger.info('Renamed topic', { sessionId, threadId });
    } else {
      logger.warn('editForumTopic failed', { sessionId, threadId });
    }
  } else if (!sessionSnap) {
    logger.warn('Session not in DB; sending flat message without topic', { sessionId });
  }

  const messageHtml = buildMessageHtml(text, contactName, contactCompany, shortId);
  const telegramMessageId = await sendTelegramMessage(
    messageHtml,
    threadId ? { threadId } : undefined
  );

  emitEvent(
    telegramMessageId ? 'handoff_delivered' : 'handoff_failed',
    telegramMessageId
      ? { handoffId: `relay:${sessionId}`, durationMs: 0 }
      : { handoffId: `relay:${sessionId}`, reason: 'telegram_send_failed' },
    requestId
  );

  const insertPayload: Record<string, unknown> = {
    session_id: sessionId,
    sender: 'user',
    text,
    telegram_message_id: telegramMessageId?.messageId ?? null,
    telegram_thread_id: threadId
  };

  const { error: insertError } = await supabase.from('human_messages').insert(insertPayload);

  if (insertError) {
    logger.error('Failed to insert user message', {
      sessionId,
      threadId,
      telegramMessageId: telegramMessageId?.messageId,
      insertError: insertError.message ?? insertError
    });
  } else {
    await supabase
      .from('sessions')
      .update({ status: 'escalated' })
      .eq('id', sessionId);
    emitEvent('session_status_changed', { sessionId, newStatus: 'escalated' }, requestId);
  }

  if (Object.keys(detectedUpdates).length > 0) {
    const { error: sessionUpdateError } = await supabase
      .from('sessions')
      .update(detectedUpdates)
      .eq('id', sessionId);

    if (sessionUpdateError) {
      logger.error('Failed to update session detected fields', {
        sessionId,
        sessionUpdateError: sessionUpdateError.message ?? sessionUpdateError
      });
    }
  }

  return jsonWithCors({
    ok: telegramMessageId !== null,
    sessionId,
    telegramSent: telegramMessageId !== null,
    persisted: !insertError,
    threadId
  }, undefined, request);
}
