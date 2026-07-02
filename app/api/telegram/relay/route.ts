import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { createForumTopic, editForumTopic, sendTelegramMessage } from '@/lib/telegram';

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

function buildTopicName(name: string | null | undefined, company: string | null | undefined, shortId: string): string {
  const parts: string[] = [];
  if (name?.trim()) parts.push(name.trim());
  if (company?.trim()) parts.push(company.trim());
  const label = parts.length > 0 ? parts.join(' / ') : 'New inquiry';
  return `${label} (${shortId})`.slice(0, 128);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, relayPayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, text } = parsed.data;
  const shortId = sessionId.slice(0, 8);

  const detectedName = detectName(text);
  const detectedCompany = detectCompany(text);

  if (!hasSupabaseServerConfig()) {
    const fallbackMessage = await sendTelegramMessage(
      `<b>[${shortId}]</b>\n${escapeHtml(text)}`
    );
    return jsonWithCors({ ok: true, sessionId, telegramSent: fallbackMessage !== null, persisted: false });
  }

  const supabase = createServerSupabaseClient();

  if (!supabase) {
    const fallbackMessage = await sendTelegramMessage(
      `<b>[${shortId}]</b>\n${escapeHtml(text)}`
    );
    return jsonWithCors({ ok: true, sessionId, telegramSent: fallbackMessage !== null, persisted: false });
  }

  const { data: existingRow } = await supabase
    .from('sessions')
    .select('telegram_thread_id, contact_name, contact_company')
    .eq('id', sessionId)
    .maybeSingle();

  type SessionSnapshot = {
    telegram_thread_id?: number | null;
    contact_name?: string | null;
    contact_company?: string | null;
  };

  const sessionSnap = existingRow as SessionSnapshot | null;
  let threadId = sessionSnap?.telegram_thread_id ?? null;
  let contactName = sessionSnap?.contact_name ?? null;
  let contactCompany = sessionSnap?.contact_company ?? null;

  const updates: Record<string, unknown> = {};
  if (detectedName && !contactName) {
    contactName = detectedName;
    updates.contact_name = contactName;
  }
  if (detectedCompany && !contactCompany) {
    contactCompany = detectedCompany;
    updates.contact_company = contactCompany;
  }

  let newTopicName: string | null = null;
  if (!threadId || (contactName && !sessionSnap?.contact_name) || (contactCompany && !sessionSnap?.contact_company)) {
    newTopicName = buildTopicName(contactName, contactCompany, shortId);
  }

  if (!threadId) {
    const topic = await createForumTopic(newTopicName ?? buildTopicName(contactName, contactCompany, shortId));

    if (topic) {
      threadId = topic.threadId;
      updates.telegram_thread_id = threadId;
      console.log('[telegram-relay] Created topic', { sessionId, threadId, name: newTopicName });
    } else {
      console.warn('[telegram-relay] createForumTopic failed; falling back to flat message');
    }
  } else if (newTopicName) {
    const updated = await editForumTopic(threadId, newTopicName);
    if (updated) {
      console.log('[telegram-relay] Renamed topic', { sessionId, threadId, name: newTopicName });
    } else {
      console.warn('[telegram-relay] editForumTopic failed', { sessionId, threadId });
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error: sessionUpdateError } = await supabase
      .from('sessions')
      .update(updates)
      .eq('id', sessionId);

    if (sessionUpdateError) {
      console.error('[telegram-relay] Failed to update session', { sessionId, updates, sessionUpdateError });
    }
  }

  const telegramMessageId = await sendTelegramMessage(
    `<b>[${shortId}]</b>\n${escapeHtml(text)}`,
    threadId ? { threadId } : undefined
  );

  const { error } = await supabase.from('human_messages').insert({
    session_id: sessionId,
    sender: 'user',
    text,
    telegram_message_id: telegramMessageId?.messageId ?? null,
    telegram_thread_id: threadId
  });

  if (error) {
    console.error('[telegram-relay] Failed to insert user message', {
      sessionId,
      telegramMessageId: telegramMessageId?.messageId,
      threadId,
      error
    });
  } else {
    await supabase
      .from('sessions')
      .update({ status: 'escalated' })
      .eq('id', sessionId);
  }

  return jsonWithCors({
    ok: true,
    sessionId,
    telegramSent: telegramMessageId !== null,
    persisted: !error,
    threadId
  });
}