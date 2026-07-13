import { NextRequest } from 'next/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { extractSessionIdFromCapability } from '@/lib/security/session-capability';

const { hasSupabaseServerConfigMock, createServerSupabaseClientMock } = vi.hoisted(() => ({
  hasSupabaseServerConfigMock: vi.fn(),
  createServerSupabaseClientMock: vi.fn()
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

import { POST } from '@/app/api/sessions/route';
import { OPTIONS } from '@/app/api/sessions/route';

const validConsent = {
  consentVersion: '2026-07-11',
  consentedAt: '2026-07-11T10:00:00.000Z'
};

beforeEach(() => {
  hasSupabaseServerConfigMock.mockReset();
  createServerSupabaseClientMock.mockReset();
  hasSupabaseServerConfigMock.mockReturnValue(true);
  createServerSupabaseClientMock.mockImplementation(() => ({
    from: () => ({
      insert: (session: Record<string, unknown>) => ({
        select: () => ({
          single: async () => ({
            data: {
              id: session.id,
              status: 'open',
              source_url: session.source_url,
              created_at: '2026-07-13T10:00:00.000Z'
            },
            error: null
          })
        })
      })
    })
  }));
});

test('persists and returns the ID embedded in the session capability', async () => {
  let insertedSession: Record<string, unknown> | undefined;
  createServerSupabaseClientMock.mockReturnValue({
    from: () => ({
      insert: (session: Record<string, unknown>) => {
        insertedSession = session;
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: session.id,
                status: 'open',
                source_url: session.source_url,
                created_at: '2026-07-13T10:00:00.000Z'
              },
              error: null
            })
          })
        };
      }
    })
  });
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv', ...validConsent })
  });

  const response = await POST(request);
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.sessionId).toBeTruthy();
  expect(payload.capability).toBeUndefined();
  expect(payload.expiresAt).toBeTruthy();

  expect(insertedSession?.id).toBe(payload.sessionId);

  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toContain('session_capability=');
  expect(setCookie).toContain('HttpOnly');
  const capability = setCookie?.match(/session_capability=([^;]+)/)?.[1];
  expect(extractSessionIdFromCapability(capability ?? '')).toBe(payload.sessionId);
});

test('fails closed without a capability cookie when session persistence is unavailable', async () => {
  hasSupabaseServerConfigMock.mockReturnValue(false);
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv', ...validConsent })
  });

  const response = await POST(request);

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({ ok: false, code: 'session_unavailable' });
  expect(response.headers.get('set-cookie')).toBeNull();
});

test('fails closed without a capability cookie when the session insert fails', async () => {
  createServerSupabaseClientMock.mockReturnValue({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: { code: '23505', message: 'internal detail' } })
        })
      })
    })
  });
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv', ...validConsent })
  });

  const response = await POST(request);

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({ ok: false, code: 'session_unavailable' });
  expect(response.headers.get('set-cookie')).toBeNull();
});

test('returns 400 for invalid JSON body', async () => {
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: 'not-json'
  });

  const response = await POST(request);

  expect(response.status).toBe(400);
});

test('returns 400 for schema-invalid payload', async () => {
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: 'not-a-url', ...validConsent })
  });

  const response = await POST(request);

  expect(response.status).toBe(400);
});

test('includes CORS headers in response', async () => {
  const request = new NextRequest('https://www.balancestudio.tv/api/sessions', {
    method: 'POST',
    headers: { origin: 'https://www.balancestudio.tv' },
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv', ...validConsent })
  });

  const response = await POST(request);

  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.balancestudio.tv');
  expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-session-capability');
  expect(response.headers.get('Vary')).toBe('Origin');
});

test('sets an HttpOnly SameSite session capability cookie without Secure on localhost', async () => {
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000' },
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv', ...validConsent })
  });

  const response = await POST(request);
  const setCookie = response.headers.get('set-cookie');

  expect(setCookie).toContain('session_capability=');
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=lax');
  expect(setCookie).not.toContain('Secure');
});

test('sets a Secure session capability cookie on https requests', async () => {
  const request = new NextRequest('https://www.balancestudio.tv/api/sessions', {
    method: 'POST',
    headers: { origin: 'https://www.balancestudio.tv' },
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv', ...validConsent })
  });

  const response = await POST(request);
  const setCookie = response.headers.get('set-cookie');

  expect(setCookie).toContain('session_capability=');
  expect(setCookie).toContain('Secure');
});

test('returns 400 when notice consent is missing', async () => {
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv' })
  });

  const response = await POST(request);

  expect(response.status).toBe(400);
});

test('does not advertise an unrelated origin in preflight responses', async () => {
  const request = new NextRequest('https://www.balancestudio.tv/api/sessions', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.com' }
  });

  const response = await OPTIONS(request);

  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-session-capability');
});
