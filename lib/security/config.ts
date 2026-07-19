import { timingSafeEqual } from 'crypto';

export interface AdminConfig {
  setupToken: string;
}

export interface WebhookConfig {
  webhookSecret: string | null;
}

export type TelegramSenderAllowlist =
  | { ok: true; userIds: number[] }
  | { ok: false; error: 'TELEGRAM_ALLOWED_USER_IDS not configured' | 'TELEGRAM_ALLOWED_USER_IDS invalid' | 'TELEGRAM_ALLOWED_USERNAMES is no longer supported; migrate to TELEGRAM_ALLOWED_USER_IDS' };

export function parseTelegramSenderAllowlist(env: Record<string, string | undefined> = process.env): TelegramSenderAllowlist {
  const configured = env.TELEGRAM_ALLOWED_USER_IDS?.trim();
  if (!configured) {
    if (env.TELEGRAM_ALLOWED_USERNAMES?.trim()) {
      return { ok: false, error: 'TELEGRAM_ALLOWED_USERNAMES is no longer supported; migrate to TELEGRAM_ALLOWED_USER_IDS' };
    }
    return { ok: false, error: 'TELEGRAM_ALLOWED_USER_IDS not configured' };
  }

  const values = configured.split(',').map((value) => value.trim());
  if (values.some((value) => !/^[1-9]\d*$/.test(value))) {
    return { ok: false, error: 'TELEGRAM_ALLOWED_USER_IDS invalid' };
  }
  const userIds = values.map(Number);
  if (userIds.some((value) => !Number.isSafeInteger(value))) {
    return { ok: false, error: 'TELEGRAM_ALLOWED_USER_IDS invalid' };
  }
  return { ok: true, userIds: [...new Set(userIds)] };
}

export function requireAdminConfig(): AdminConfig {
  const token = process.env.SETUP_TOKEN;

  if (!token) {
    throw new Error('SETUP_TOKEN environment variable is required for admin operations');
  }

  return { setupToken: token };
}

export function requireWebhookSecret(): WebhookConfig {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error(
      'TELEGRAM_WEBHOOK_SECRET environment variable is required in production'
    );
  }

  return { webhookSecret: secret ?? null };
}

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export function validateAdminRequest(
  request: Request,
  envVar: string = 'SETUP_TOKEN'
): AdminAuthResult {
  const secret = process.env[envVar];

  if (!secret) {
    return { ok: false, status: 503, error: `${envVar} not configured` };
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const provided = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!provided) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
}

export function validateAdminRequestAny(
  request: Request,
  envVars: string[]
): AdminAuthResult {
  const configured = envVars
    .map((envVar) => ({ envVar, secret: process.env[envVar] }))
    .filter((entry): entry is { envVar: string; secret: string } => Boolean(entry.secret));

  if (configured.length === 0) {
    return { ok: false, status: 503, error: `${envVars.join(' or ')} not configured` };
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const provided = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!provided) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const a = Buffer.from(provided);
  for (const { secret } of configured) {
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true };
    }
  }

  return { ok: false, status: 401, error: 'Unauthorized' };
}
