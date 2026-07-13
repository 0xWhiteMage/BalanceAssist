// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  hasSupabaseServerConfigMock,
  createServerSupabaseClientMock,
  claimNextHandoffMock,
  deleteForumTopicMock,
} = vi.hoisted(() => ({
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        not: vi.fn(() => Promise.resolve({ data: [], error: null })),
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: {}, error: null })) })) },
  })),
  claimNextHandoffMock: vi.fn(async () => null),
  deleteForumTopicMock: vi.fn(async () => true),
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

vi.mock('@/lib/handoff/outbox', () => ({
  claimNextHandoff: claimNextHandoffMock,
  markDelivered: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: vi.fn(),
  ensureTelegramTopic: vi.fn(),
  editForumTopic: vi.fn(),
  deleteForumTopic: deleteForumTopicMock,
}));

describe('privileged routes fail closed when secrets are unset', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.SETUP_TOKEN;
    delete process.env.CRON_SECRET;
    delete process.env.INTERNAL_DISPATCH_SECRET;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_CHAT_ID;
    hasSupabaseServerConfigMock.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('GET /api/internal/uploads returns 503 when SETUP_TOKEN is unset', async () => {
    const { GET } = await import('@/app/api/internal/uploads/route');
    const request = new Request('http://localhost/api/internal/uploads');
    const response = await GET(request);
    expect(response.status).toBe(503);
  });

  test('GET /api/internal/uploads returns 401 when SETUP_TOKEN is set but no auth header', async () => {
    process.env.SETUP_TOKEN = 'secret-token';
    const { GET } = await import('@/app/api/internal/uploads/route');
    const request = new Request('http://localhost/api/internal/uploads');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  test('GET /api/internal/uploads returns 401 with wrong token', async () => {
    process.env.SETUP_TOKEN = 'secret-token';
    const { GET } = await import('@/app/api/internal/uploads/route');
    const request = new Request('http://localhost/api/internal/uploads', {
      headers: { authorization: 'Bearer wrong-token' },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  test('GET /api/internal/uploads succeeds with correct token', async () => {
    process.env.SETUP_TOKEN = 'secret-token';
    const { GET } = await import('@/app/api/internal/uploads/route');
    const request = new Request('http://localhost/api/internal/uploads', {
      headers: { authorization: 'Bearer secret-token' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  test('POST /api/internal/handoff-dispatch returns 503 when INTERNAL_DISPATCH_SECRET is unset', async () => {
    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const request = new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
    });
    const response = await POST(request);
    expect(response.status).toBe(503);
  });

  test('POST /api/internal/handoff-dispatch returns 401 when secret is set but no auth header', async () => {
    process.env.INTERNAL_DISPATCH_SECRET = 'dispatch-secret';
    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const request = new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  test('POST /api/internal/handoff-dispatch accepts CRON_SECRET for scheduled invocation', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const { POST } = await import('@/app/api/internal/handoff-dispatch/route');
    const request = new Request('http://localhost/api/internal/handoff-dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret' }
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  test('POST /api/telegram/cleanup-topics returns 503 when SETUP_TOKEN is unset', async () => {
    const { POST } = await import('@/app/api/telegram/cleanup-topics/route');
    const request = new Request('http://localhost/api/telegram/cleanup-topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadIds: [1] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(503);
  });

  test('GET /api/telegram/list-topics returns 503 when SETUP_TOKEN is unset', async () => {
    const { GET } = await import('@/app/api/telegram/list-topics/route');
    const request = new Request('http://localhost/api/telegram/list-topics');
    const response = await GET(request);
    expect(response.status).toBe(503);
  });

  test('GET /api/sessions/inspect?id=X returns 503 when SETUP_TOKEN is unset', async () => {
    const { GET } = await import('@/app/api/sessions/inspect/route');
    const request = new Request('http://localhost/api/sessions/inspect?id=sess-123');
    const response = await GET(request);
    expect(response.status).toBe(503);
  });

  test('GET /api/sessions/inspect?id=X returns 401 with wrong token', async () => {
    process.env.SETUP_TOKEN = 'secret-token';
    const { GET } = await import('@/app/api/sessions/inspect/route');
    const request = new Request('http://localhost/api/sessions/inspect?id=sess-123', {
      headers: { authorization: 'Bearer wrong' },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});
