import { describe, it, expect, afterEach } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
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
});
