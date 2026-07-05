import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/telegram';

const payloadSchema = z.object({
  sessionId: z.string().min(1)
});

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, payloadSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId } = parsed.data;

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return jsonWithCors({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('telegram_thread_id')
    .eq('id', sessionId)
    .maybeSingle();

  const session = sessionRow as { telegram_thread_id?: number | null } | null;
  if (!session) {
    return jsonWithCors({ ok: false, error: 'Session not found' }, { status: 404 });
  }

  await supabase
    .from('sessions')
    .update({ schedule_request_open: false })
    .eq('id', sessionId);

  const shortId = sessionId.slice(0, 8);
  const sent = await sendTelegramMessage(
    `<b>📅 Calendly booked</b>\n<code>${shortId}</code>\nThe client completed a call booking.`,
    session.telegram_thread_id ? { threadId: session.telegram_thread_id } : undefined
  );

  const { error } = await supabase.from('human_messages').insert({
    session_id: sessionId,
    sender: 'team',
    text: 'Balance Assist: The client completed a call booking.',
    telegram_thread_id: session.telegram_thread_id ?? null,
    telegram_message_id: sent?.messageId ?? null
  });

  if (error) {
    return jsonWithCors({ ok: false, error: error.message }, { status: 500 });
  }

  return jsonWithCors({ ok: true, sent: sent !== null });
}
