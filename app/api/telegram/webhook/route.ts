import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { createLogger, extractRequestId } from '@/lib/logger';
import { verifyWebhookChatId, verifyWebhookSecret, verifyWebhookSender } from '@/lib/telegram/webhook-auth';
import type { TelegramUpdate } from '@/lib/telegram';
import { parseTelegramSenderAllowlist } from '@/lib/security/config';
import { readJsonBodyLimited } from '@/lib/api/route-helpers';

const MAX_TELEGRAM_UPDATE_BYTES = 256 * 1024;

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

  const configuredChatId = process.env.TELEGRAM_CHAT_ID ?? null;
  if (!configuredChatId) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_CHAT_ID not configured' }, { status: 503 });
  }

  const allowlist = parseTelegramSenderAllowlist();
  if (!allowlist.ok) {
    return NextResponse.json({ ok: false, error: allowlist.error }, { status: 503 });
  }

  const body = await readJsonBodyLimited(request, MAX_TELEGRAM_UPDATE_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false, error: body.tooLarge ? 'Payload too large' : 'Invalid JSON' },
      { status: body.tooLarge ? 413 : 400 }
    );
  }
  const update = body.data as TelegramUpdate;
  const message = update.message;

  const incomingChatId = message?.chat?.id;
  if (typeof incomingChatId !== 'number' || !verifyWebhookChatId(incomingChatId, configuredChatId)) {
    logger.warn('Wrong chat ID', { incoming: incomingChatId ?? null, expected: configuredChatId });
    return NextResponse.json({ ok: true, ignored: 'wrong-chat' });
  }

  const senderUserId = message?.from?.id ?? null;
  if (!verifyWebhookSender(senderUserId, allowlist.userIds)) {
    logger.warn('Unauthorized sender', { hasSenderUserId: senderUserId !== null });
    return NextResponse.json({ ok: true, ignored: 'unauthorized-sender' });
  }

  if (!hasSupabaseServerConfig()) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  let claimedUpdateId: number | null = null;
  const retryableFailure = async (error: string) => {
    if (claimedUpdateId !== null) {
      try {
        const { error: releaseError } = await supabase
          .from('processed_telegram_updates')
          .delete()
          .eq('update_id', claimedUpdateId);
        if (releaseError) logger.error('Failed to release update_id', { updateId: claimedUpdateId });
      } catch {
        logger.error('Failed to release update_id', { updateId: claimedUpdateId });
      }
    }
    return NextResponse.json({ ok: false, error }, { status: 500 });
  };

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
    claimedUpdateId = update.update_id;
  }

  if (!message?.text) {
    return NextResponse.json({ ok: true, ignored: 'no-text' });
  }

  let sessionId: string | null = null;

  // Primary: thread ID lookup (most reliable)
  if (typeof message.message_thread_id === 'number') {
    const { data: byThread, error: threadLookupError } = await supabase
      .from('sessions')
      .select('id')
      .eq('telegram_thread_id', message.message_thread_id)
      .maybeSingle();

    if (threadLookupError) {
      logger.error('Failed to look up session by thread', { updateId: update.update_id });
      return retryableFailure('session_lookup_failed');
    }

    const byThreadRow = byThread as { id?: string } | null;
    sessionId = byThreadRow?.id ?? null;
  }

  // Secondary: reply-to-message lookup
  if (!sessionId && message.reply_to_message?.message_id) {
    const { data: parent, error: parentLookupError } = await supabase
      .from('human_messages')
      .select('session_id')
      .eq('telegram_message_id', message.reply_to_message.message_id)
      .maybeSingle();

    if (parentLookupError) {
      logger.error('Failed to look up session by parent message', { updateId: update.update_id });
      return retryableFailure('session_lookup_failed');
    }

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
    const calendlyUrl = getEnv().CALENDLY_URL?.trim();

    if (!calendlyUrl) {
      const { error: unavailableMessageError } = await supabase.from('human_messages').insert({
        session_id: sessionId,
        sender: 'team',
        text: `${senderName}: Scheduling is currently unavailable. We will arrange a time directly.`,
        telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
      });
      if (unavailableMessageError) return retryableFailure(unavailableMessageError.message);
      return NextResponse.json({ ok: true, sessionId, scheduleRequestOpen: false, schedulingAvailable: false });
    }

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
      return retryableFailure(scheduleUpdateError.message);
    }

    logger.info('Schedule request state updated', { sessionId });

    const { error: scheduleMessageError } = await supabase.from('human_messages').insert({
      session_id: sessionId,
      sender: 'team',
      text: note
          ? `${senderName}: Please book a 15-minute call using the configured calendar below. ${note}`
          : `${senderName}: Please book a 15-minute call using the configured calendar that just appeared in your chat.`,
      telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
    });

    if (scheduleMessageError) {
      logger.error('Failed to insert schedule message', {
        sessionId,
        error: scheduleMessageError.message
      });
      return retryableFailure(scheduleMessageError.message);
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
      return retryableFailure(sessionUpdateError.message);
    }

    logger.info('File request state updated', { sessionId });

    const { error: requestMessageError } = await supabase.from('human_messages').insert({
      session_id: sessionId,
      sender: 'team',
        text: note
          ? `${senderName}: We need ${note}. File delivery in this chat is currently unavailable; please reply to coordinate a supported transfer method.`
          : `${senderName}: We need files for this project. File delivery in this chat is currently unavailable; please reply to coordinate a supported transfer method.`,
      telegram_thread_id: typeof message.message_thread_id === 'number' ? message.message_thread_id : null
    });

    if (requestMessageError) {
      logger.error('Failed to insert file request message', {
        sessionId,
        error: requestMessageError.message,
        code: requestMessageError.code
      });
      return retryableFailure(requestMessageError.message);
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
    logger.error('Failed to insert team message', { error: 'team_message_persist_failed' });
    return retryableFailure('team_message_persist_failed');
  }

  return NextResponse.json({ ok: true, sessionId });
}
