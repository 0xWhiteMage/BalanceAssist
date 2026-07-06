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
    message_thread_id?: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    reply_to_message?: {
      message_id: number;
      message_thread_id?: number;
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
  options?: { replyToMessageId?: number; threadId?: number }
): Promise<{ messageId: number } | null> {
  const config = getTelegramConfig();

  if (!config) {
    return null;
  }

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: config.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  if (options?.replyToMessageId) {
    body.reply_to_message_id = options.replyToMessageId;
  }

  if (options?.threadId) {
    body.message_thread_id = options.threadId;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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

export async function sendTelegramDocument(
  file: File,
  options?: { caption?: string; threadId?: number }
): Promise<{ messageId: number } | null> {
  const config = getTelegramConfig();

  if (!config) {
    return null;
  }

  const form = new FormData();
  form.set('chat_id', config.chatId);
  form.set('document', file, file.name);

  if (options?.caption) {
    form.set('caption', options.caption);
    form.set('parse_mode', 'HTML');
  }

  if (options?.threadId) {
    form.set('message_thread_id', String(options.threadId));
  }

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, {
    method: 'POST',
    body: form
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

export type SendDocumentResponse = {
  ok: boolean;
  result?: {
    message_id: number;
    document?: { file_id: string; file_unique_id?: string };
  };
  description?: string;
};

export async function sendDocument(
  threadId: number | null | undefined,
  buffer: Buffer,
  caption: string,
  filename: string
): Promise<SendDocumentResponse | null> {
  const config = getTelegramConfig();

  if (!config) {
    return null;
  }

  const form = new FormData();
  form.set('chat_id', config.chatId);
  const blob = new Blob([new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)]);
  form.set('document', blob, filename);
  form.set('caption', caption);
  form.set('parse_mode', 'HTML');

  if (threadId) {
    form.set('message_thread_id', String(threadId));
  }

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as SendDocumentResponse;
  return data;
}

export async function createForumTopic(
  name: string,
  options?: { iconColor?: number }
): Promise<{ threadId: number; name: string } | null> {
  const config = getTelegramConfig();

  if (!config) {
    return null;
  }

  const body: Record<string, unknown> = {
    chat_id: config.chatId,
    name: name.slice(0, 128)
  };

  if (options?.iconColor !== undefined) {
    body.icon_color = options.iconColor;
  }

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/createForumTopic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as TelegramResponse & {
    result?: { message_thread_id?: number; name?: string };
  };

  if (!data.ok || !data.result?.message_thread_id) {
    return null;
  }

  return {
    threadId: data.result.message_thread_id,
    name: data.result.name ?? name
  };
}

export async function editForumTopic(
  threadId: number,
  name: string,
  options?: { iconColor?: number }
): Promise<boolean> {
  const config = getTelegramConfig();

  if (!config) {
    return false;
  }

  const body: Record<string, unknown> = {
    chat_id: config.chatId,
    message_thread_id: threadId,
    name: name.slice(0, 128)
  };

  if (options?.iconColor !== undefined) {
    body.icon_color = options.iconColor;
  }

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/editForumTopic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  return response.ok;
}

export async function closeForumTopic(threadId: number): Promise<boolean> {
  const config = getTelegramConfig();

  if (!config) {
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/closeForumTopic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      message_thread_id: threadId
    })
  });

  return response.ok;
}

export async function deleteForumTopic(threadId: number): Promise<boolean> {
  const config = getTelegramConfig();

  if (!config) {
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/deleteForumTopic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      message_thread_id: threadId
    })
  });

  return response.ok;
}

export function extractSessionIdFromText(text: string): string | null {
  const match = text.match(/\[Session ([a-f0-9-]+)\]/i);
  return match?.[1] ?? null;
}
