// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

function buildSupabase(options?: { draft?: Record<string, unknown>; draftVersion?: number; consentTransitions?: Array<{ scope: string; granted: boolean }> }) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const deletedLinkScopes: Array<{ id: string; sessionId: string }> = [];
  const draft = options?.draft ?? {};
  const draftVersion = options?.draftVersion ?? 0;
  const consentTransitions = options?.consentTransitions ?? [];

  return {
    inserts,
    updates,
    deletedLinkScopes,
    client: {
      from: vi.fn((table: string) => {
        if (table === 'sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { draft, draft_version: draftVersion }, error: null }))
              }))
            })),
            update: vi.fn((row: Record<string, unknown>) => {
              updates.push(row);
              return { eq: vi.fn(async () => ({ error: null })) };
            })
          };
        }

        if (table === 'session_consents') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(async () => ({ data: consentTransitions, error: null }))
              }))
            }))
          };
        }

        if (table === 'reference_links') {
          return {
            insert: vi.fn((row: Record<string, unknown>) => {
              inserts.push(row);
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: { id: '11111111-1111-4111-8111-111111111111', ...row }, error: null }))
                }))
              };
            }),
            delete: vi.fn(() => ({
              eq: vi.fn((column: string, id: string) => {
                expect(column).toBe('id');
                return {
                  eq: vi.fn((sessionColumn: string, sessionId: string) => {
                    expect(sessionColumn).toBe('session_id');
                    deletedLinkScopes.push({ id, sessionId });
                    return { select: vi.fn(async () => ({ data: [{ id }], error: null })) };
                  })
                };
              })
            }))
          };
        }

        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            inserts.push(row);
            return Promise.resolve({ error: null });
          })
        };
      })
    }
  };
}

describe('POST /api/attachments/link', () => {
  beforeEach(() => {
    vi.resetModules();
    requireSessionMock.mockReset();
    const { client } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-1', capability: 'sess-1.secret' },
      supabase: client
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('persists a reference link for a session with a prior producer-transfer grant', async () => {
    const { client, inserts } = buildSupabase({ consentTransitions: [{ scope: 'producer_transfer', granted: true }] });
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-1', capability: 'sess-1.secret' },
      supabase: client
    });

    const { POST } = await import('@/app/api/attachments/link/route');
      const req = new Request('http://localhost/api/attachments/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess-1',
          url: 'https://youtu.be/abc',
          kind: 'youtube'
        })
      });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      session_id: 'sess-1',
      url: 'https://youtu.be/abc',
      kind: 'youtube'
    });
    expect(data.link).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', sessionId: 'sess-1' });
  });

  test('uses the authenticated session when sessionId is omitted', async () => {
    const { client, inserts } = buildSupabase({ consentTransitions: [{ scope: 'producer_transfer', granted: true }] });
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-auth', capability: 'sess-auth.secret' },
      supabase: client
    });

    const { POST } = await import('@/app/api/attachments/link/route');
      const req = new Request('http://localhost/api/attachments/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://youtu.be/abc',
          kind: 'youtube'
        })
      });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].session_id).toBe('sess-auth');
  });

  test('authenticates before reading an invalid body', async () => {
    requireSessionMock.mockResolvedValue({ ok: false, response: new Response('{}', { status: 401 }) });
    const { POST } = await import('@/app/api/attachments/link/route');
    const response = await POST(new Request('http://localhost/api/attachments/link', { method: 'POST', body: 'not-json' }));
    expect(response.status).toBe(401);
  });

  test('rejects an oversized authenticated body', async () => {
    const { POST } = await import('@/app/api/attachments/link/route');
    const response = await POST(new Request('http://localhost/api/attachments/link', {
      method: 'POST', headers: { 'content-length': String(17 * 1024) }, body: '{}'
    }));
    expect(response.status).toBe(413);
  });

  test('rejects malformed URLs', async () => {
    const { POST } = await import('@/app/api/attachments/link/route');
      const req = new Request('http://localhost/api/attachments/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess-1',
          url: 'not a url',
          kind: 'youtube'
        })
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
  });

  test.each(['http://example.com/reference', 'ftp://example.com/reference'])(
    'rejects non-HTTPS reference %s with a stable 400',
    async (url) => {
      const { POST } = await import('@/app/api/attachments/link/route');
      const response = await POST(new Request('http://localhost/api/attachments/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-1', url, kind: 'other' })
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false, persisted: false, error: 'https_reference_required'
      });
      expect(requireSessionMock).toHaveBeenCalledOnce();
    }
  );

  test('normalizes an HTTPS reference before persistence', async () => {
    const { client, inserts } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: true, auth: { sessionId: 'sess-auth', capability: 'sess-auth.secret' }, supabase: client
    });
    const { POST } = await import('@/app/api/attachments/link/route');
    const response = await POST(new Request('http://localhost/api/attachments/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://EXAMPLE.com./board?z=2&a=1', kind: 'other' })
    }));

    expect(response.status).toBe(200);
    expect(inserts[0].url).toBe('https://example.com/board?a=1&z=2');
    await expect(response.json()).resolves.toMatchObject({
      link: { url: 'https://example.com/board?a=1&z=2' }
    });
  });

  test('privately stores a session-owned link without producer-transfer consent', async () => {
    const { client, inserts } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-auth', capability: 'sess-auth.secret' },
      supabase: client
    });

    const { POST } = await import('@/app/api/attachments/link/route');
    const req = new Request('http://localhost/api/attachments/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://youtu.be/abc',
          kind: 'youtube'
      })
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ ok: true, persisted: true });
    expect(inserts).toEqual([{
      session_id: 'sess-auth',
      url: 'https://youtu.be/abc',
      kind: 'youtube'
    }]);
    expect(client.from).not.toHaveBeenCalledWith('session_consents');
  });

  test('accepts links when producer-transfer consent was already recorded in the ledger', async () => {
    const { client, inserts } = buildSupabase({
      consentTransitions: [{ scope: 'producer_transfer', granted: true }]
    });
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-auth', capability: 'sess-auth.secret' },
      supabase: client
    });

    const { POST } = await import('@/app/api/attachments/link/route');
    const req = new Request('http://localhost/api/attachments/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://youtu.be/abc',
        kind: 'youtube'
      })
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  test('deletes only a link owned by the authenticated session', async () => {
    const { client, deletedLinkScopes } = buildSupabase();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-auth', capability: 'sess-auth.secret' },
      supabase: client
    });

    const { DELETE } = await import('@/app/api/attachments/link/[linkId]/route');
    const linkId = '11111111-1111-4111-8111-111111111111';
    const res = await DELETE(new Request(`http://localhost/api/attachments/link/${linkId}`, { method: 'DELETE' }), {
      params: Promise.resolve({ linkId })
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, deletedLinkId: linkId });
    expect(deletedLinkScopes).toEqual([{ id: linkId, sessionId: 'sess-auth' }]);
  });
});
