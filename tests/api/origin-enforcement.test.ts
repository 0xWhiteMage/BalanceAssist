// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hashCapability } from '@/lib/security/session-capability';

const CAPABILITY = 'sess-1.abc123';
const CAP_HASH = hashCapability(CAPABILITY);

const {
  hasSupabaseServerConfigMock,
  createServerSupabaseClientMock,
} = vi.hoisted(() => ({
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { capability_hash: CAP_HASH, capability_expires_at: new Date(Date.now() + 86400000).toISOString() },
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe('requireSession origin enforcement', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    (process.env as Record<string, string>).NODE_ENV = 'test';
    hasSupabaseServerConfigMock.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test('rejects POST from untrusted origin with 403', async () => {
    const { requireSession } = await import('@/lib/api/require-session');
    const request = new Request('http://localhost/api/telegram/relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://evil.com',
        cookie: `session_capability=${CAPABILITY}`,
      },
      body: JSON.stringify({ sessionId: 'sess-1', text: 'hi' }),
    });

    const result = await requireSession(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  test('rejects POST with null origin', async () => {
    const { requireSession } = await import('@/lib/api/require-session');
    const request = new Request('http://localhost/api/telegram/relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_capability=${CAPABILITY}`,
      },
      body: JSON.stringify({ sessionId: 'sess-1', text: 'hi' }),
    });

    const result = await requireSession(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  test('allows POST from trusted origin', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'development';
    const { requireSession } = await import('@/lib/api/require-session');
    const request = new Request('http://localhost/api/telegram/relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost:3000',
        cookie: `session_capability=${CAPABILITY}`,
      },
      body: JSON.stringify({ sessionId: 'sess-1', text: 'hi' }),
    });

    const result = await requireSession(request);
    expect(result.ok).toBe(true);
  });

  test('allows GET without origin check', async () => {
    const { requireSession } = await import('@/lib/api/require-session');
    const request = new Request('http://localhost/api/telegram/messages?sessionId=sess-1', {
      method: 'GET',
      headers: {
        cookie: `session_capability=${CAPABILITY}`,
      },
    });

    const result = await requireSession(request);
    expect(result.ok).toBe(true);
  });

  test('allows production origin', async () => {
    const { requireSession } = await import('@/lib/api/require-session');
    const request = new Request('https://balancestudio.tv/api/telegram/relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://balancestudio.tv',
        cookie: `session_capability=${CAPABILITY}`,
      },
      body: JSON.stringify({ sessionId: 'sess-1', text: 'hi' }),
    });

    const result = await requireSession(request);
    expect(result.ok).toBe(true);
  });

  test('permits upload mode, session, and request IDs from the explicit Vercel origin', async () => {
    const { corsOptionsResponse } = await import('@/lib/api/route-helpers');
    const response = corsOptionsResponse('https://balance-assist.vercel.app');

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://balance-assist.vercel.app');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-request-id');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-session-id');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-upload-mode');
  });
});
