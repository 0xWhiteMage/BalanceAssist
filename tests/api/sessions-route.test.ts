import { NextRequest } from 'next/server';
import { POST } from '@/app/api/sessions/route';
import { OPTIONS } from '@/app/api/sessions/route';

const validConsent = {
  consentVersion: '2026-07-11',
  consentedAt: '2026-07-11T10:00:00.000Z'
};

test('creates a session response with capability set via cookie only', async () => {
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

  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toContain('session_capability=');
  expect(setCookie).toContain('HttpOnly');
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
