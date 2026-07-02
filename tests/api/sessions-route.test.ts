import { NextRequest } from 'next/server';
import { POST } from '@/app/api/sessions/route';

test('creates a session response payload', async () => {
  const request = new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: 'https://www.balancestudio.tv' })
  });

  const response = await POST(request);
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.sessionId).toBeTruthy();
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

  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
});
