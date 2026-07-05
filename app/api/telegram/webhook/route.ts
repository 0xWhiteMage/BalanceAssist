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

  if (typeof message.message_thread_id === 'number') {
    const { data: byThread } = await supabase
      .from('sessions')
      .select('id')
      .eq('telegram_thread_id', message.message_thread_id)
      .maybeSingle();

    const byThreadRow = byThread as { id?: string } | null;
    sessionId = byThreadRow?.id ?? null;
  }

  if (!sessionId && message.reply_to_message?.message_id) {
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
      thread_id: message.message_thread_id,
      reply_to_message_id: message.reply_to_message?.message_id,
      chat_id: message.chat?.id,
      from: message.from?.username ?? message.from?.first_name
    });
    return NextResponse.json({ ok: true, ignored: 'no-matching-session' });
  }

  const senderName = message.from?.first_name ?? message.from?.username ?? 'Team';

  const helpMatch = message.text.match(/^\/help(?:@\w+)?$/i);
  if (helpMatch) {
    return NextResponse.json({ ok: true, ignored: 'help-command' });
  }

  const scheduleMatch = message.text.match(/^\/schedule(?:@\w+)?\s*(.*)$/i);
  if (scheduleMatch) {
    const note = scheduleMatch[1]?.trim() || null;

    console.log('[telegram-webhook] /schedule received', {
      sessionId,
      threadId: message.message_thread_id,
      note
    });

    const { error: scheduleUpdateError } = await supabase
      .from('sessions')
      .update({ schedule_request_open: true })
      .eq('id', sessionId);

    if (scheduleUpdateError) {
      console.error('[telegram-webhook] Failed to update schedule request state', {
        sessionId,
        error: scheduleUpdateError.message,
        code: scheduleUpdateError.code
      });
      return NextResponse.json({ ok: false, error: scheduleUpdateError.message }, { status: 500 });
    }

    console.log('[telegram-webhook] Schedule request state updated', { sessionId });

    const { error: scheduleMessageError } = await supabase.from('human_messages').insert({
      session_id: sessionId,
      sender: 'team',
      text: note
        ? `${senderName}: Please book a call using the calendar below. ${note}`
        : `${senderName}: Please book a discovery call using the calendar that just appeared in your chat.`,
      telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
    });

    if (scheduleMessageError) {
      console.error('[telegram-webhook] Failed to insert schedule message', {
        sessionId,
        error: scheduleMessageError.message
      });
      return NextResponse.json({ ok: false, error: scheduleMessageError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sessionId, scheduleRequestOpen: true });
  }

  const requestFilesMatch = message.text.match(/^\/request_files(?:@\w+)?\s*(.*)$/i);
  if (requestFilesMatch) {
    const note = requestFilesMatch[1]?.trim() || null;

    console.log('[telegram-webhook] /request_files received', {
      sessionId,
      threadId: message.message_thread_id,
      note
    });

    const { error: sessionUpdateError } = await supabase
      .from('sessions')
      .update({ file_request_open: true, file_request_note: note })
      .eq('id', sessionId);

    if (sessionUpdateError) {
      console.error('[telegram-webhook] Failed to update file request state', {
        sessionId,
        error: sessionUpdateError.message,
        code: sessionUpdateError.code
      });
      return NextResponse.json({ ok: false, error: sessionUpdateError.message }, { status: 500 });
    }

    console.log('[telegram-webhook] File request state updated', { sessionId });

    const { error: requestMessageError } = await supabase.from('human_messages').insert({
      session_id: sessionId,
      sender: 'team',
      text: note
        ? `${senderName}: Please upload ${note}. Use the attachment (paperclip) icon on the left of the message box to attach your files.`
        : `${senderName}: Please upload the files for this project. Use the attachment (paperclip) icon on the left of the message box to attach your files.`,
      telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
    });

    if (requestMessageError) {
      console.error('[telegram-webhook] Failed to insert file request message', {
        sessionId,
        error: requestMessageError.message,
        code: requestMessageError.code
      });
      return NextResponse.json({ ok: false, error: requestMessageError.message }, { status: 500 });
    }

    console.log('[telegram-webhook] File request message inserted', { sessionId });

    return NextResponse.json({ ok: true, sessionId, fileRequestOpen: true });
  }

  const { error } = await supabase.from('human_messages').insert({
    session_id: sessionId,
    sender: 'team',
    text: `${senderName}: ${message.text}`,
    telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
  });

  if (error) {
    console.error('[telegram-webhook] Failed to insert team message', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessionId });
}
