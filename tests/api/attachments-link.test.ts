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
  const draft = options?.draft ?? {};
  const draftVersion = options?.draftVersion ?? 0;
  const consentTransitions = options?.consentTransitions ?? [];

  return {
    inserts,
    updates,
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

  test('rejects forged producer-share consent when the ledger has no grant', async () => {
    const { client } = buildSupabase();
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

    expect(res.status).toBe(403);
    expect(data).toEqual({ ok: false, code: 'consent_required' });
  });

  test('rejects links when consent is omitted', async () => {
    const { client } = buildSupabase();
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

    expect(res.status).toBe(403);
    expect(data).toEqual({ ok: false, code: 'consent_required' });
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
});
