import { NextRequest } from 'next/server';
import { POST } from '@/app/api/sessions/route';

test('creates a session response with capability', async () => {
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv' })
  });

  const response = await POST(request);
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.sessionId).toBeTruthy();
  expect(payload.capability).toBeTruthy();
  expect(payload.capability).toContain(payload.sessionId);
  expect(payload.expiresAt).toBeTruthy();
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
    body: JSON.stringify({ sourceUrl: 'not-a-url' })
  });

  const response = await POST(request);

  expect(response.status).toBe(400);
});

test('includes CORS headers in response', async () => {
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv' })
  });

  const response = await POST(request);

  expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  expect(response.headers.get('Vary')).toBe('Origin');
});
