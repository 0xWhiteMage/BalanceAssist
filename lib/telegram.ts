type TelegramResponse = {
  ok: boolean;
  result?: {
    message_id: number;
    chat: { id: number };
  };
  description?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    reply_to_message?: {
      message_id: number;
      from?: { id: number };
      chat?: { id: number };
      text?: string;
    };
  };
};

export function getTelegramConfig(): { botToken: string; chatId: string } | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return null;
  }

  return { botToken, chatId };
}

export async function sendTelegramMessage(
  text: string,
  options?: { replyToMessageId?: number }
): Promise<{ messageId: number } | null> {
  const config = getTelegramConfig();

  if (!config) {
    return null;
  }

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_to_message_id: options?.replyToMessageId
    })
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as TelegramResponse;

  if (!data.ok || !data.result) {
    return null;
  }

  return { messageId: data.result.message_id };
}

export function extractSessionIdFromText(text: string): string | null {
  const match = text.match(/\[Session ([a-f0-9-]+)\]/i);
  return match?.[1] ?? null;
}