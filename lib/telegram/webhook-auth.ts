import { timingSafeEqual } from 'crypto';

export type WebhookAuthResult =
  | { ok: true; secretValid: true; chatIdValid: true; senderValid: true }
  | { ok: false; reason: 'missing-secret' | 'invalid-secret' | 'wrong-chat' | 'unauthorized-sender' };

export function verifyWebhookSecret(
  headerSecret: string | null,
  configuredSecret: string | null
): boolean {
  if (!configuredSecret) return false;
  if (!headerSecret) return false;

  const a = Buffer.from(headerSecret);
  const b = Buffer.from(configuredSecret);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export function verifyWebhookChatId(
  incomingChatId: number,
  configuredChatId: string | null
): boolean {
  if (!configuredChatId) return false;
  return String(incomingChatId) === configuredChatId;
}

export function verifyWebhookSender(
  senderUsername: string | null,
  allowedUsernames: string[] | null
): boolean {
  if (!allowedUsernames || allowedUsernames.length === 0) return false;
  if (!senderUsername) return false;
  return allowedUsernames.includes(senderUsername.toLowerCase());
}

export function validateWebhookRequest(params: {
  headerSecret: string | null;
  configuredSecret: string | null;
  incomingChatId: number;
  configuredChatId: string | null;
  senderUsername: string | null;
  allowedUsernames: string[] | null;
}): WebhookAuthResult {
  const { headerSecret, configuredSecret, incomingChatId, configuredChatId, senderUsername, allowedUsernames } = params;

  if (!configuredSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  if (!verifyWebhookSecret(headerSecret, configuredSecret)) {
    return { ok: false, reason: 'invalid-secret' };
  }

  if (!verifyWebhookChatId(incomingChatId, configuredChatId)) {
    return { ok: false, reason: 'wrong-chat' };
  }

  if (!verifyWebhookSender(senderUsername, allowedUsernames)) {
    return { ok: false, reason: 'unauthorized-sender' };
  }

  return { ok: true, secretValid: true, chatIdValid: true, senderValid: true };
}
