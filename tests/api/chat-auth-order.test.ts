import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { consumeRateLimitMock } = vi.hoisted(() => ({ consumeRateLimitMock: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: () => true,
  createServerSupabaseClient: vi.fn()
}));

vi.mock('@/lib/security/rate-limit', () => ({
  consumeRateLimit: consumeRateLimitMock
}));

const originalFetch = global.fetch;
const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  consumeRateLimitMock.mockReset();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalDeepseekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
});

test('uses requireSession to reject a missing capability before parsing or provider activity', async () => {
  const { POST } = await import('@/app/api/chat/route');
  const response = await POST(new Request('https://balancestudio.tv/api/chat', {
    method: 'POST',
    headers: { Origin: 'https://balancestudio.tv', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
  }));

  expect(response.status).toBe(401);
  expect(consumeRateLimitMock).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('uses requireSession origin enforcement before parsing or provider activity', async () => {
  const { POST } = await import('@/app/api/chat/route');
  const response = await POST(new Request('https://balancestudio.tv/api/chat', {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'x-session-capability': 'session.secret',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
  }));

  expect(response.status).toBe(403);
  expect(consumeRateLimitMock).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
