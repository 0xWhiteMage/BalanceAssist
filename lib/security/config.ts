import { timingSafeEqual } from 'crypto';

export interface AdminConfig {
  setupToken: string;
}

export interface WebhookConfig {
  webhookSecret: string | null;
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
