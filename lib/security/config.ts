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
