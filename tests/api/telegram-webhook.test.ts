import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  verifyWebhookSecret,
  verifyWebhookChatId,
  verifyWebhookSender,
  validateWebhookRequest
} from '@/lib/telegram/webhook-auth';

const originalEnv = { ...process.env };

const { hasSupabaseServerConfigMock, createServerSupabaseClientMock } = vi.hoisted(() => ({
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn()
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

function buildWebhookSupabase() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'processed_telegram_updates') {
        return {
          insert: vi.fn(async () => ({ error: null }))
        };
      }

      return {
        insert: vi.fn(async () => ({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null }))
          }))
        }))
      };
    })
  };
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  hasSupabaseServerConfigMock.mockReturnValue(true);
  createServerSupabaseClientMock.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('verifyWebhookSecret', () => {
  it('returns true for matching secrets', () => {
    expect(verifyWebhookSecret('my-secret', 'my-secret')).toBe(true);
  });

  it('returns false for mismatched secrets', () => {
    expect(verifyWebhookSecret('wrong', 'correct')).toBe(false);
  });

  it('returns false when header is null', () => {
    expect(verifyWebhookSecret(null, 'correct')).toBe(false);
  });

  it('returns false when configured is null', () => {
    expect(verifyWebhookSecret('header', null)).toBe(false);
  });

  it('uses timing-safe comparison (same length, different content)', () => {
    expect(verifyWebhookSecret('aaaa', 'bbbb')).toBe(false);
  });

  it('returns false for different length secrets', () => {
    expect(verifyWebhookSecret('short', 'longer-secret')).toBe(false);
  });
});

describe('verifyWebhookChatId', () => {
  it('returns true for matching chat ID', () => {
    expect(verifyWebhookChatId(123456, '123456')).toBe(true);
  });

  it('returns false for mismatched chat ID', () => {
    expect(verifyWebhookChatId(123456, '654321')).toBe(false);
  });

  it('returns false when configured is null', () => {
    expect(verifyWebhookChatId(123456, null)).toBe(false);
  });
});

describe('verifyWebhookSender', () => {
  it('returns false when no allowlist is configured', () => {
    expect(verifyWebhookSender('anyone', null)).toBe(false);
  });

  it('returns true for matching username', () => {
    expect(verifyWebhookSender('admin', ['admin', 'mod'])).toBe(true);
  });

  it('returns true case-insensitively', () => {
    expect(verifyWebhookSender('Admin', ['admin'])).toBe(true);
  });

  it('returns false for unknown sender', () => {
    expect(verifyWebhookSender('hacker', ['admin'])).toBe(false);
  });

  it('returns false when sender is null but allowlist exists', () => {
    expect(verifyWebhookSender(null, ['admin'])).toBe(false);
  });
});

describe('validateWebhookRequest', () => {
  it('rejects when secret is not configured', () => {
    const result = validateWebhookRequest({
      headerSecret: null,
      configuredSecret: null,
      incomingChatId: 123,
      configuredChatId: '123',
      senderUsername: 'admin',
      allowedUsernames: null
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing-secret');
  });

  it('rejects invalid secret', () => {
    const result = validateWebhookRequest({
      headerSecret: 'wrong',
      configuredSecret: 'correct',
      incomingChatId: 123,
      configuredChatId: '123',
      senderUsername: 'admin',
      allowedUsernames: null
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-secret');
  });

  it('rejects wrong chat ID', () => {
    const result = validateWebhookRequest({
      headerSecret: 'secret',
      configuredSecret: 'secret',
      incomingChatId: 999,
      configuredChatId: '123',
      senderUsername: 'admin',
      allowedUsernames: null
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong-chat');
  });

  it('rejects unauthorized sender', () => {
    const result = validateWebhookRequest({
      headerSecret: 'secret',
      configuredSecret: 'secret',
      incomingChatId: 123,
      configuredChatId: '123',
      senderUsername: 'hacker',
      allowedUsernames: ['admin']
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized-sender');
  });

  it('accepts valid request', () => {
    const result = validateWebhookRequest({
      headerSecret: 'secret',
      configuredSecret: 'secret',
      incomingChatId: 123,
      configuredChatId: '123',
      senderUsername: 'admin',
      allowedUsernames: ['admin']
    });
    expect(result.ok).toBe(true);
  });
});

describe('POST /api/telegram/webhook', () => {
  it('fails closed on a missing secret header before parsing the body', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret';

    const { POST } = await import('@/app/api/telegram/webhook/route');
    const request = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json'
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('parses the update before validating configured chat and sender rules', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret';
    process.env.TELEGRAM_CHAT_ID = '123456';
    process.env.TELEGRAM_ALLOWED_USERNAMES = 'admin';
    createServerSupabaseClientMock.mockReturnValue(buildWebhookSupabase());

    const { POST } = await import('@/app/api/telegram/webhook/route');
    const request = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'secret'
      },
      body: JSON.stringify({
        update_id: 7,
        message: {
          text: 'Hello from Telegram',
          chat: { id: 123456 },
          from: { username: 'admin', first_name: 'Admin' }
        }
      })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: 'no-matching-session' });
  });

  it('fails closed with 503 when TELEGRAM_CHAT_ID is unset in production', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret';
    delete process.env.TELEGRAM_CHAT_ID;

    const { POST } = await import('@/app/api/telegram/webhook/route');
    const request = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'secret'
      },
      body: JSON.stringify({
        update_id: 8,
        message: {
          text: 'Hello',
          chat: { id: 123 },
          from: { username: 'admin' }
        }
      })
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
  });

  it('fails closed with 503 when TELEGRAM_ALLOWED_USERNAMES is unset in production', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret';
    process.env.TELEGRAM_CHAT_ID = '123';
    delete process.env.TELEGRAM_ALLOWED_USERNAMES;

    const { POST } = await import('@/app/api/telegram/webhook/route');
    const request = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'secret'
      },
      body: JSON.stringify({
        update_id: 8,
        message: {
          text: 'Hello',
          chat: { id: 123 },
          from: { username: 'admin' }
        }
      })
    });

    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error).toMatch(/TELEGRAM_ALLOWED_USERNAMES/i);
  });

  it('ignores update from wrong chat ID', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret';
    process.env.TELEGRAM_CHAT_ID = '123456';
    createServerSupabaseClientMock.mockReturnValue(buildWebhookSupabase());

    const { POST } = await import('@/app/api/telegram/webhook/route');
    const request = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'secret'
      },
      body: JSON.stringify({
        update_id: 9,
        message: {
          text: 'Hello from wrong chat',
          chat: { id: 999 },
          from: { username: 'admin' }
        }
      })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: 'wrong-chat' });
  });
});
