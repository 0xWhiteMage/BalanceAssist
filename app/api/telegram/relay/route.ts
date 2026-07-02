import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { createForumTopic, getTelegramConfig, sendTelegramMessage } from '@/lib/telegram';

const relayPayloadSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000)
});

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, relayPayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, text } = parsed.data;

  if (!hasSupabaseServerConfig()) {
    const fallbackMessage = await sendTelegramMessage(
      `<b>[Session ${sessionId}]</b>\n${escapeHtml(text)}\n\n<i>Reply to this message to respond to the user.</i>`
    );

    return jsonWithCors({
      ok: true,
      sessionId,
      telegramSent: fallbackMessage !== null,
      persisted: false
    });
  }

  const supabase = createServerSupabaseClient();

  if (!supabase) {
    console.warn('[telegram-relay] Supabase client creation failed despite hasSupabaseServerConfig() returning true');
    const fallbackMessage = await sendTelegramMessage(
      `<b>[Session ${sessionId}]</b>\n${escapeHtml(text)}`
    );
    return jsonWithCors({ ok: true, sessionId, telegramSent: fallbackMessage !== null, persisted: false });
  }

  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('telegram_thread_id')
    .eq('id', sessionId)
    .maybeSingle();

  let threadId = (sessionRow as { telegram_thread_id?: number | null } | null)?.telegram_thread_id ?? null;

  if (!threadId) {
    const shortId = sessionId.slice(0, 8);
    const topic = await createForumTopic(`Lead ${shortId}`);

    if (topic) {
      threadId = topic.threadId;
      const { error: updateError } = await supabase
        .from('sessions')
        .update({ telegram_thread_id: threadId })
        .eq('id', sessionId);

      if (updateError) {
        console.error('[telegram-relay] Failed to persist thread_id', { sessionId, threadId, updateError });
      }
    } else {
      console.warn('[telegram-relay] createForumTopic failed; falling back to flat message');
    }
  }

  const telegramMessageId = await sendTelegramMessage(
    `<b>[Session ${sessionId.slice(0, 8)}]</b>\n${escapeHtml(text)}\n\n<i>Reply in this topic to respond to the user.</i>`,
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}