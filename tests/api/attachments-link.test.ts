// @vitest-environment node
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = global.fetch;

describe('POST /api/attachments/link', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  test('persists a reference link for a session', async () => {
    const insertCalls: unknown[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/rest/v1/reference_links')) {
        insertCalls.push('insert');
        return new Response(JSON.stringify([{ id: 1 }]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const { POST } = await import('@/app/api/attachments/link/route');
    const req = new Request('http://localhost/api/attachments/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', url: 'https://youtu.be/abc', kind: 'youtube' })
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(insertCalls.length).toBe(1);
  });

  test('rejects malformed URLs', async () => {
    const { POST } = await import('@/app/api/attachments/link/route');
    const req = new Request('http://localhost/api/attachments/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', url: 'not a url', kind: 'youtube' })
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});