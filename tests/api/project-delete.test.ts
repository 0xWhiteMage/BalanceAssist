// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: vi.fn(() => false),
  createServerSupabaseClient: vi.fn()
}));

import { POST } from '@/app/api/projects/[sessionId]/delete/route';

async function callDeleteRoute(sessionId: string) {
  const req = new Request(`http://localhost/api/projects/${sessionId}/delete`, {
    method: 'POST'
  });
  return POST(req, { params: Promise.resolve({ sessionId }) });
}

describe('POST /api/projects/[sessionId]/delete', () => {
  test('returns success with honest limitations message', async () => {
    const res = await callDeleteRoute('test-session-123');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.sessionId).toBe('test-session-123');
    expect(data.message).toBe(
      'Your project data has been deleted from our active system. Note: Telegram messages and backup copies may be retained per our data retention policy.'
    );
    expect(data.requestedAt).toBeTruthy();
  });

  test('returns 400 for invalid session ID', async () => {
    const res = await callDeleteRoute('');
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid session ID');
  });

  test('includes requestedAt timestamp', async () => {
    const before = Date.now();
    const res = await callDeleteRoute('session-ts-test');
    const data = await res.json();
    const after = Date.now();

    expect(data.requestedAt).toBeTruthy();
    const ts = new Date(data.requestedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test('logs the deletion request', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await callDeleteRoute('session-log-test');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[project-delete] Deletion requested for session session-log-test')
    );

    logSpy.mockRestore();
  });
});

describe('POST /api/projects/[sessionId]/draft', () => {
  test('GET returns empty draft for new session', async () => {
    const { GET } = await import('@/app/api/projects/[sessionId]/draft/route');
    const req = new Request('http://localhost/api/projects/test-session/draft');
    const res = await GET(req, { params: Promise.resolve({ sessionId: 'test-session' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessionId).toBe('test-session');
    expect(data.draft).toEqual({});
    expect(data.fieldCount).toBe(0);
  });

  test('PUT updates fields in the draft', async () => {
    const { PUT, GET } = await import('@/app/api/projects/[sessionId]/draft/route');
    const sessionId = 'draft-update-test';

    const putReq = new Request('http://localhost/api/projects/draft-update-test/draft', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: [
          { field: 'service', value: 'production', provenance: 'user-stated' },
          { field: 'contactName', value: 'Jayden', provenance: 'inferred' }
        ]
      })
    });
    const putRes = await PUT(putReq, { params: Promise.resolve({ sessionId }) });
    const putData = await putRes.json();

    expect(putRes.status).toBe(200);
    expect(putData.fieldCount).toBe(2);
    expect(putData.draft.service.value).toBe('production');
    expect(putData.draft.service.provenance).toBe('user-stated');

    const getReq = new Request('http://localhost/api/projects/draft-update-test/draft');
    const getRes = await GET(getReq, { params: Promise.resolve({ sessionId }) });
    const getData = await getRes.json();

    expect(getData.fieldCount).toBe(2);
  });

  test('PUT clears a field', async () => {
    const { PUT, GET } = await import('@/app/api/projects/[sessionId]/draft/route');
    const sessionId = 'draft-clear-test';

    await PUT(
      new Request('http://localhost/api/projects/draft-clear-test/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: [{ field: 'service', value: 'production', provenance: 'user-stated' }]
        })
      }),
      { params: Promise.resolve({ sessionId }) }
    );

    const clearRes = await PUT(
      new Request('http://localhost/api/projects/draft-clear-test/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: [{ field: 'service', value: '', provenance: 'cleared' }]
        })
      }),
      { params: Promise.resolve({ sessionId }) }
    );
    const clearData = await clearRes.json();

    expect(clearData.draft.service.provenance).toBe('cleared');
    expect(clearData.draft.service.value).toBe('');
  });

  test('PUT rejects invalid provenance', async () => {
    const { PUT } = await import('@/app/api/projects/[sessionId]/draft/route');

    const res = await PUT(
      new Request('http://localhost/api/projects/bad-prov/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: [{ field: 'service', value: 'production', provenance: 'invalid' }]
        })
      }),
      { params: Promise.resolve({ sessionId: 'bad-prov' }) }
    );

    expect(res.status).toBe(400);
  });

  test('PUT rejects empty fields array', async () => {
    const { PUT } = await import('@/app/api/projects/[sessionId]/draft/route');

    const res = await PUT(
      new Request('http://localhost/api/projects/empty-fields/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: [] })
      }),
      { params: Promise.resolve({ sessionId: 'empty-fields' }) }
    );

    expect(res.status).toBe(400);
  });
});
