import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { getSessionConsent } from '@/lib/privacy/session-consent';
import { enqueueHandoff } from '@/lib/handoff/outbox';

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
  const threadId = sessionSnap?.telegram_thread_id ?? null;
  const messageHtml = buildMessageHtml(text, sessionSnap?.contact_name ?? null, sessionSnap?.contact_company ?? null, sessionId.slice(0, 8));
  const handoff = await enqueueHandoff(supabase as never, { sessionId, type: 'relay', summary: messageHtml, threadId });

  const insertPayload: Record<string, unknown> = {
    session_id: sessionId,
    sender: 'user',
    text,
    telegram_message_id: null,
    telegram_thread_id: threadId
  };

  const { error: insertError } = await supabase.from('human_messages').insert(insertPayload);

  if (insertError) {
    logger.error('Failed to insert user message', {
      sessionId,
      threadId,
      insertError: insertError.message ?? insertError
    });
  } else {
    await supabase
      .from('sessions')
      .update({ status: 'escalated' })
      .eq('id', sessionId);
    emitEvent('session_status_changed', { sessionId, newStatus: 'escalated' }, requestId);
  }

  return jsonWithCors({
    ok: handoff.persisted,
    sessionId,
    telegramSent: false,
    queued: handoff.queued,
    persisted: !insertError,
    threadId
  }, undefined, request);
}
