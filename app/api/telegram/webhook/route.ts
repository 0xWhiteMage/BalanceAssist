import { NextResponse } from 'next/server';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import type { TelegramUpdate } from '@/lib/telegram';

export async function POST(request: Request) {
  let update: TelegramUpdate;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const message = update.message;

  if (!message?.text) {
    return NextResponse.json({ ok: true, ignored: 'no-text' });
  }

  if (!hasSupabaseServerConfig()) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  let sessionId: string | null = null;

  if (message.reply_to_message?.message_id) {
    const { data: parent } = await supabase
      .from('human_messages')
      .select('session_id')
      .eq('telegram_message_id', message.reply_to_message.message_id)
      .maybeSingle();

    const parentRow = parent as { session_id?: string } | null;
    sessionId = parentRow?.session_id ?? null;
  }

  if (!sessionId) {
    const { data: latest } = await supabase
      .from('human_messages')
      .select('session_id')
      .eq('sender', 'user')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestRow = latest as { session_id?: string } | null;
    sessionId = latestRow?.session_id ?? null;
  }

  if (!sessionId) {
    console.warn('[telegram-webhook] No matching session for update', {
      reply_to_message_id: message.reply_to_message?.message_id,
      chat_id: message.chat?.id,
      from: message.from?.username ?? message.from?.first_name
    });
    return NextResponse.json({ ok: true, ignored: 'no-matching-session' });
  }

  const senderName = message.from?.first_name ?? message.from?.username ?? 'Team';

  const { error } = await supabase.from('human_messages').insert({
    session_id: sessionId,
    sender: 'team',
    text: `${senderName}: ${message.text}`
  });

  if (error) {
    console.error('[telegram-webhook] Failed to insert team message', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessionId });
}