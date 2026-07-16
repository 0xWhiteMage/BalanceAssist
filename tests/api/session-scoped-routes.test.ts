// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  requireSessionMock,
  hasSupabaseServerConfigMock,
  createServerSupabaseClientMock,
  sendTelegramMessageMock,
  ensureTelegramTopicMock,
  enqueueHandoffMock
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn(() => null),
  sendTelegramMessageMock: vi.fn(async () => ({ messageId: 1 })),
  ensureTelegramTopicMock: vi.fn(async () => null),
  enqueueHandoffMock: vi.fn(async () => ({
    persisted: true,
    queued: true,
    delivered: false,
    retryable: false,
    handoffId: 'ho-test-123'
  }))
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock,
  ensureTelegramTopic: ensureTelegramTopicMock,
  editForumTopic: vi.fn(async () => true)
}));

vi.mock('@/lib/handoff/outbox', () => ({
  enqueueHandoff: enqueueHandoffMock
}));

function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Session capability required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

function mockUnauthorizedSession() {
  requireSessionMock.mockResolvedValue({
    ok: false,
    response: unauthorizedResponse()
  });
}

function buildReferenceLinkSupabase() {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const consentOrder = vi.fn(async () => ({
    data: [{ scope: 'producer_transfer', granted: true, created_at: '2026-07-13T10:00:00.000Z', id: 'consent-1' }],
    error: null
  }));
  const consentEq = vi.fn(() => ({ order: consentOrder }));
  const consentSelect = vi.fn(() => ({ eq: consentEq }));

  return {
    inserts,
    consentSelect,
    consentEq,
    consentOrder,
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { draft: {}, draft_version: 0 }, error: null }))
              }))
            })),
            update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
          };
        }

        if (table === 'session_consents') {
          return {
            select: consentSelect
          };
        }

        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            inserts.push({ table, row });
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: 'link-1', ...row },
                  error: null
                }))
              }))
            };
          })
        };
      })
    }
  };
}

describe('session-scoped API routes', () => {
  beforeEach(() => {
    vi.resetModules();
    requireSessionMock.mockReset();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue(null);
    sendTelegramMessageMock.mockReset();
    sendTelegramMessageMock.mockResolvedValue({ messageId: 1 });
    ensureTelegramTopicMock.mockReset();
    ensureTelegramTopicMock.mockResolvedValue(null);
    enqueueHandoffMock.mockReset();
    enqueueHandoffMock.mockResolvedValue({
      persisted: true,
      queued: true,
      delivered: false,
      retryable: false,
      handoffId: 'ho-test-123'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('GET /api/telegram/messages requires session auth and forwards the query sessionId', async () => {
    mockUnauthorizedSession();

    const { GET } = await import('@/app/api/telegram/messages/route');
    const request = new Request('http://localhost/api/telegram/messages?sessionId=sess-messages');
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(requireSessionMock).toHaveBeenCalledWith(request, 'sess-messages');
  });

  test('POST /api/telegram/relay requires session auth and forwards the body sessionId', async () => {
    mockUnauthorizedSession();

    const { POST } = await import('@/app/api/telegram/relay/route');
    const request = new Request('http://localhost/api/telegram/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-relay', text: 'Hello team' })
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(requireSessionMock).toHaveBeenCalledWith(request, 'sess-relay');
  });

  test('POST /api/telegram/upload requires session auth and forwards the session header', async () => {
    mockUnauthorizedSession();

    const form = new FormData();
    form.set('sessionId', 'sess-upload');
    form.set('kind', 'reference');
    form.set(
      'consent',
      JSON.stringify({ aiAnalysis: true, producerShare: true, consentedAt: new Date().toISOString() })
    );
    form.append('files', new File([new Uint8Array([1, 2, 3])], 'brief.txt', { type: 'text/plain' }));

    const formDataSpy = vi.spyOn(Request.prototype, 'formData').mockResolvedValue(form);

    try {
      const { POST } = await import('@/app/api/telegram/upload/route');
      const request = new Request('http://localhost/api/telegram/upload', {
        method: 'POST',
        headers: { 'x-session-id': 'sess-upload' }
      });
      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(requireSessionMock).toHaveBeenCalledWith(request, 'sess-upload');
    } finally {
      formDataSpy.mockRestore();
    }
  });

  test('POST /api/telegram/schedule-complete requires session auth and forwards the body sessionId', async () => {
    mockUnauthorizedSession();

    const { POST } = await import('@/app/api/telegram/schedule-complete/route');
    const request = new Request('http://localhost/api/telegram/schedule-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-schedule' })
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(requireSessionMock).toHaveBeenCalledWith(request, 'sess-schedule');
  });

  test('POST /api/attachments/link uses the authenticated session when sessionId is omitted', async () => {
    const { inserts, consentEq, consentOrder, consentSelect, supabase } = buildReferenceLinkSupabase();

    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: 'sess-link-auth', capability: 'sess-link-auth.secret' },
      supabase
    });

    const { POST } = await import('@/app/api/attachments/link/route');
    const request = new Request('http://localhost/api/attachments/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://youtu.be/abc',
        kind: 'youtube',
        consent: { aiAnalysis: false, producerShare: true, consentedAt: new Date().toISOString() }
      })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      persisted: true,
      link: { id: 'link-1', sessionId: 'sess-link-auth' }
    });
    expect(requireSessionMock).toHaveBeenCalledWith(request, undefined);
    expect(consentSelect).toHaveBeenCalledWith('scope, granted, created_at, id');
    expect(consentEq).toHaveBeenCalledWith('session_id', 'sess-link-auth');
    expect(consentOrder).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(inserts).toContainEqual({
      table: 'reference_links',
      row: {
        session_id: 'sess-link-auth',
        url: 'https://youtu.be/abc',
        kind: 'youtube'
      }
    });
  });

  test('POST /api/leads/finalize requires session auth and forwards the body sessionId', async () => {
    mockUnauthorizedSession();

    const { POST } = await import('@/app/api/leads/finalize/route');
    const request = new Request('http://localhost/api/leads/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'sess-finalize',
        qualificationStatus: 'qualified',
        leadDraft: {
          service: 'production',
          projectScope: '30s animation',
          timelineBand: '1-2-months',
          budgetBand: '20k-50k',
          contactName: 'Jayden',
          contactEmail: 'jayden@example.com'
        }
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(requireSessionMock).toHaveBeenCalledWith(request);
  });
});
