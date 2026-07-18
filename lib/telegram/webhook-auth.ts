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
  senderUserId: number | null,
  allowedUserIds: number[] | null
): boolean {
  if (!allowedUserIds || allowedUserIds.length === 0) return false;
  if (!Number.isSafeInteger(senderUserId) || (senderUserId ?? 0) <= 0) return false;
  return allowedUserIds.includes(senderUserId as number);
}

export function validateWebhookRequest(params: {
  headerSecret: string | null;
  configuredSecret: string | null;
  incomingChatId: number;
  configuredChatId: string | null;
  senderUserId: number | null;
  allowedUserIds: number[] | null;
}): WebhookAuthResult {
  const { headerSecret, configuredSecret, incomingChatId, configuredChatId, senderUserId, allowedUserIds } = params;

  if (!configuredSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  if (!verifyWebhookSecret(headerSecret, configuredSecret)) {
    return { ok: false, reason: 'invalid-secret' };
  }

  if (!verifyWebhookChatId(incomingChatId, configuredChatId)) {
    return { ok: false, reason: 'wrong-chat' };
  }

  if (!verifyWebhookSender(senderUserId, allowedUserIds)) {
    return { ok: false, reason: 'unauthorized-sender' };
  }

  return { ok: true, secretValid: true, chatIdValid: true, senderValid: true };
}
