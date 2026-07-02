import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { getTelegramConfig, sendTelegramMessage } from '@/lib/telegram';

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

  const telegramMessageId = await sendTelegramMessage(
    `<b>[Session ${sessionId}]</b>\n${escapeHtml(text)}`
  );

  if (hasSupabaseServerConfig()) {
    const supabase = createServerSupabaseClient();

    if (supabase) {
      const { error } = await supabase.from('human_messages').insert({
        session_id: sessionId,
        sender: 'user',
        text,
        telegram_message_id: telegramMessageId?.messageId ?? null
      });

      if (!error) {
        await supabase
          .from('sessions')
          .update({ status: 'escalated' })
          .eq('id', sessionId);
      }

      return jsonWithCors({
        ok: true,
        sessionId,
        telegramSent: telegramMessageId !== null
      });
    }
  }

  return jsonWithCors({
    ok: true,
    sessionId,
    telegramSent: telegramMessageId !== null
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}