import { describe, it, expect, afterEach } from 'vitest';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

describe('telegram/setup route security', () => {
  it('POST requires admin auth when SETUP_TOKEN is set', async () => {
    process.env.SETUP_TOKEN = 'admin-secret';
    process.env.TELEGRAM_BOT_TOKEN = '';

    const { POST } = await import('@/app/api/telegram/setup/route');
    const request = new Request('http://localhost:3000/api/telegram/setup', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('POST fails closed when SETUP_TOKEN is not set', async () => {
    delete process.env.SETUP_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = '';

    const { POST } = await import('@/app/api/telegram/setup/route');
    const request = new Request('http://localhost:3000/api/telegram/setup', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('PUT requires admin auth when SETUP_TOKEN is set', async () => {
    process.env.SETUP_TOKEN = 'admin-secret';
    process.env.TELEGRAM_BOT_TOKEN = '';

    const { PUT } = await import('@/app/api/telegram/setup/route');
    const request = new Request('http://localhost:3000/api/telegram/setup', {
      method: 'PUT'
    });

    const response = await PUT(request);
    expect(response.status).toBe(401);
  });

  it('response never exposes key prefixes', async () => {
    process.env.SETUP_TOKEN = 'admin-secret';
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.SUPABASE_SECRET_KEY = 'sb-secret-key-12345';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb-service-key-67890';

    const { POST } = await import('@/app/api/telegram/setup/route');
    const request = new Request('http://localhost:3000/api/telegram/setup', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const response = await POST(request);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);

    expect(bodyStr).not.toContain('sb-secret-key');
    expect(bodyStr).not.toContain('sb-service-key');
    expect(bodyStr).not.toContain('secret_key_prefix');
    expect(bodyStr).not.toContain('service_role_key_prefix');
  });

  it('POST sends secret_token when configuring the Telegram webhook', async () => {
    process.env.SETUP_TOKEN = 'admin-secret';
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.TELEGRAM_CHAT_ID = '-1001234567890';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';

    const telegramCalls: Array<{ url: string; body: Record<string, unknown> | null }> = [];

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
      telegramCalls.push({ url, body });

      if (url.endsWith('/getMe')) {
        return new Response(JSON.stringify({ ok: true, result: { id: 1, first_name: 'Balance', username: 'balance_bot' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.endsWith('/getUpdates')) {
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.endsWith('/setWebhook')) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;

    const { POST } = await import('@/app/api/telegram/setup/route');
    const request = new Request('http://localhost:3000/api/telegram/setup', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ webhookUrl: 'https://www.balancestudio.tv/api/telegram/webhook' })
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const setWebhookCall = telegramCalls.find((call) => call.url.endsWith('/setWebhook'));
    expect(setWebhookCall?.body?.secret_token).toBe('webhook-secret');
    expect(setWebhookCall?.body?.drop_pending_updates).toBe(false);
  });
});
