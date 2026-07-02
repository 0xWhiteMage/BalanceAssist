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

  if (!message?.text || !message.reply_to_message) {
    return NextResponse.json({ ok: true, ignored: 'not-a-reply' });
  }

  if (!hasSupabaseServerConfig()) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  const { data: parent } = await supabase
    .from('human_messages')
    .select('session_id, telegram_message_id')
    .eq('telegram_message_id', message.reply_to_message.message_id)
    .single();

  if (!parent) {
    return NextResponse.json({ ok: true, ignored: 'no-matching-session' });
  }

  const sessionId = parent.session_id;
  const senderName = message.from?.first_name ?? message.from?.username ?? 'Team';

  const { error } = await supabase.from('human_messages').insert({
    session_id: sessionId,
    sender: 'team',
    text: `${senderName}: ${message.text}`
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessionId });
}