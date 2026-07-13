import { NextResponse } from 'next/server';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { createLogger, extractRequestId } from '@/lib/logger';
import { verifyWebhookChatId, verifyWebhookSecret, verifyWebhookSender } from '@/lib/telegram/webhook-auth';
import type { TelegramUpdate } from '@/lib/telegram';

export async function POST(request: Request) {
  const logger = createLogger('telegram-webhook', extractRequestId(request));
  const secretToken = request.headers.get('x-telegram-bot-api-secret-token');

  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? null;

  if (!configuredSecret) {
    return NextResponse.json({ ok: false, error: 'Webhook secret not configured' }, { status: 503 });
  }

  if (!verifyWebhookSecret(secretToken, configuredSecret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let update: TelegramUpdate;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const configuredChatId = process.env.TELEGRAM_CHAT_ID ?? null;
  if (!configuredChatId && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_CHAT_ID not configured' }, { status: 503 });
  }

  const allowedUsernames = process.env.TELEGRAM_ALLOWED_USERNAMES
    ?.split(',')
    .map(u => u.trim().toLowerCase())
    .filter(Boolean) ?? [];

  if (allowedUsernames.length === 0 && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_ALLOWED_USERNAMES not configured' }, { status: 503 });
  }

  if (!hasSupabaseServerConfig()) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  // Replay protection: persist update_id before any side effects
  if (typeof update.update_id === 'number') {
    const { error: dupeError } = await supabase
      .from('processed_telegram_updates')
      .insert({ update_id: update.update_id });

    if (dupeError) {
      if (dupeError.code === '23505') {
        return NextResponse.json({ ok: true, ignored: 'duplicate-update' });
      }
      logger.error('Failed to persist update_id', {
        updateId: update.update_id,
        error: dupeError.message
      });
      return NextResponse.json({ ok: false, error: 'Failed to record update' }, { status: 500 });
    }
  }

  const message = update.message;

  if (configuredChatId) {
    const incomingChatId = message?.chat?.id;
    if (typeof incomingChatId !== 'number' || !verifyWebhookChatId(incomingChatId, configuredChatId)) {
      logger.warn('Wrong chat ID', {
        incoming: incomingChatId ?? null,
        expected: configuredChatId
      });
      return NextResponse.json({ ok: true, ignored: 'wrong-chat' });
    }
  }

  if (allowedUsernames.length > 0) {
    const senderUsername = message?.from?.username ?? null;
    if (!verifyWebhookSender(senderUsername, allowedUsernames)) {
      logger.warn('Unauthorized sender', { hasSenderUsername: Boolean(senderUsername) });
      return NextResponse.json({ ok: true, ignored: 'unauthorized-sender' });
    }
  }

  if (!message?.text) {
    return NextResponse.json({ ok: true, ignored: 'no-text' });
  }

  let sessionId: string | null = null;

  // Primary: thread ID lookup (most reliable)
  if (typeof message.message_thread_id === 'number') {
    const { data: byThread } = await supabase
      .from('sessions')
      .select('id')
      .eq('telegram_thread_id', message.message_thread_id)
      .maybeSingle();

    const byThreadRow = byThread as { id?: string } | null;
    sessionId = byThreadRow?.id ?? null;
  }

  // Secondary: reply-to-message lookup
  if (!sessionId && message.reply_to_message?.message_id) {
    const { data: parent } = await supabase
      .from('human_messages')
      .select('session_id')
      .eq('telegram_message_id', message.reply_to_message.message_id)
      .maybeSingle();

    const parentRow = parent as { session_id?: string } | null;
    sessionId = parentRow?.session_id ?? null;
  }

  // Removed: latest-session fallback (was fail-open, could attach to wrong session)

  if (!sessionId) {
    logger.warn('No matching session for update', {
      thread_id: message.message_thread_id,
      reply_to_message_id: message.reply_to_message?.message_id,
      chat_id: message.chat?.id
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

    logger.info('/schedule received', {
      sessionId,
      threadId: message.message_thread_id
    });

    const { error: scheduleUpdateError } = await supabase
      .from('sessions')
      .update({ schedule_request_open: true })
      .eq('id', sessionId);

    if (scheduleUpdateError) {
      logger.error('Failed to update schedule request state', {
        sessionId,
        error: scheduleUpdateError.message,
        code: scheduleUpdateError.code
      });
      return NextResponse.json({ ok: false, error: scheduleUpdateError.message }, { status: 500 });
    }

    logger.info('Schedule request state updated', { sessionId });

    const { error: scheduleMessageError } = await supabase.from('human_messages').insert({
      session_id: sessionId,
      sender: 'team',
      text: note
        ? `${senderName}: Please book a call using the calendar below. ${note}`
        : `${senderName}: Please book a discovery call using the calendar that just appeared in your chat.`,
      telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
    });

    if (scheduleMessageError) {
      logger.error('Failed to insert schedule message', {
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

    logger.info('/request_files received', {
      sessionId,
      threadId: message.message_thread_id
    });

    const { error: sessionUpdateError } = await supabase
      .from('sessions')
      .update({ file_request_open: true, file_request_note: note })
      .eq('id', sessionId);

    if (sessionUpdateError) {
      logger.error('Failed to update file request state', {
        sessionId,
        error: sessionUpdateError.message,
        code: sessionUpdateError.code
      });
      return NextResponse.json({ ok: false, error: sessionUpdateError.message }, { status: 500 });
    }

    logger.info('File request state updated', { sessionId });

    const { error: requestMessageError } = await supabase.from('human_messages').insert({
      session_id: sessionId,
      sender: 'team',
      text: note
        ? `${senderName}: Please upload ${note}. Use the attachment (paperclip) icon on the left of the message box to attach your files.`
        : `${senderName}: Please upload the files for this project. Use the attachment (paperclip) icon on the left of the message box to attach your files.`,
      telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
    });

    if (requestMessageError) {
      logger.error('Failed to insert file request message', {
        sessionId,
        error: requestMessageError.message,
        code: requestMessageError.code
      });
      return NextResponse.json({ ok: false, error: requestMessageError.message }, { status: 500 });
    }

    logger.info('File request message inserted', { sessionId });

    return NextResponse.json({ ok: true, sessionId, fileRequestOpen: true });
  }

  const { error } = await supabase.from('human_messages').insert({
    session_id: sessionId,
    sender: 'team',
    text: `${senderName}: ${message.text}`,
    telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
  });

  if (error) {
    logger.error('Failed to insert team message', { error: error.message });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessionId });
}
