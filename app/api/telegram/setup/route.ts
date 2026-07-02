import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';

const setupPayloadSchema = z.object({
  webhookUrl: z.string().url().optional(),
  dropPending: z.boolean().optional()
});

type TelegramApiResponse<T> = { ok: boolean; result?: T; description?: string };

async function callTelegram<T>(botToken: string, method: string, body?: Record<string, unknown>): Promise<TelegramApiResponse<T>> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    return { ok: false, description: `HTTP ${response.status}` };
  }

  return (await response.json()) as TelegramApiResponse<T>;
}

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const setupToken = process.env.SETUP_TOKEN;

  if (setupToken) {
    const auth = request.headers.get('authorization') ?? '';
    const provided = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : auth;

    if (provided !== setupToken) {
      return jsonWithCors({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const parsed = await parseRequestBody(request, setupPayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const envChatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    return jsonWithCors({
      ok: false,
      step: 'verify_token',
      error: 'TELEGRAM_BOT_TOKEN is not set in the environment.'
    }, { status: 400 });
  }

  const summary: Record<string, unknown> = {};

  const me = await callTelegram<{ id: number; username?: string; first_name: string }>(botToken, 'getMe');

  if (!me.ok || !me.result) {
    return jsonWithCors({
      ok: false,
      step: 'verify_token',
      error: me.description ?? 'Bot token is invalid.'
    }, { status: 400 });
  }

  summary.bot = {
    username: me.result.username,
    name: me.result.first_name,
    id: me.result.id
  };

  let detectedChatId: string | null = null;
  const updates = await callTelegram<Array<{
    message?: { chat: { id: number; type: string; title?: string } };
    my_chat_member?: { chat: { id: number; type: string; title?: string } };
  }>>(botToken, 'getUpdates', { limit: 50, allowed_updates: ['message', 'my_chat_member'] });

  if (updates.ok && updates.result) {
    for (const update of updates.result) {
      const chat = update.message?.chat ?? update.my_chat_member?.chat;

      if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel' || chat.type === 'private')) {
        detectedChatId = String(chat.id);
        summary.detected_chat = { id: chat.id, type: chat.type, title: chat.title ?? null };
        break;
      }
    }
  }

  const finalChatId = envChatId ?? detectedChatId;

  if (!finalChatId) {
    return jsonWithCors({
      ok: false,
      step: 'detect_chat',
      bot: summary.bot,
      error: 'No TELEGRAM_CHAT_ID set and no recent chat found. Add the bot to a group and send a message, then re-run.'
    }, { status: 400 });
  }

  summary.chat_id = finalChatId;
  summary.chat_id_source = envChatId ? 'env' : 'detected';

  if (parsed.data.webhookUrl) {
    const setWebhook = await callTelegram<true>(botToken, 'setWebhook', {
      url: parsed.data.webhookUrl,
      drop_pending_updates: parsed.data.dropPending ?? true,
      allowed_updates: ['message', 'message_reaction']
    });

    if (!setWebhook.ok) {
      return jsonWithCors({
        ok: false,
        step: 'set_webhook',
        error: setWebhook.description ?? 'Telegram rejected the webhook URL.',
        ...summary
      }, { status: 400 });
    }

    summary.webhook = { url: parsed.data.webhookUrl, set: true };
  } else {
    const info = await callTelegram<{ url: string; pending_update_count: number; last_error_message?: string }>(botToken, 'getWebhookInfo');

    if (info.ok && info.result) {
      summary.webhook = {
        url: info.result.url || null,
        pending: info.result.pending_update_count,
        last_error: info.result.last_error_message ?? null
      };
    }
  }

  return jsonWithCors({
    ok: true,
    message: 'Telegram bot is ready. Save TELEGRAM_CHAT_ID in your environment if it was auto-detected.',
    ...summary
  });
}