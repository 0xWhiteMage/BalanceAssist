// @vitest-environment node
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const { sendTelegramMessageMock, editForumTopicMock, ensureTelegramTopicMock, hasSupabaseServerConfigMock, createServerSupabaseClientMock, enqueueHandoffMock } = vi.hoisted(() => ({
  sendTelegramMessageMock: vi.fn(async () => ({ messageId: 1 })),
  editForumTopicMock: vi.fn(async () => true),
  ensureTelegramTopicMock: vi.fn(async () => null),
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn(),
  enqueueHandoffMock: vi.fn(async () => ({ persisted: true, queued: true, delivered: false, retryable: false, handoffId: 'ho-test-123' }))
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock,
  editForumTopic: editForumTopicMock,
  ensureTelegramTopic: ensureTelegramTopicMock
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

vi.mock('@/lib/handoff/outbox', () => ({
  enqueueHandoff: enqueueHandoffMock
}));

function buildMockSupabase({
  telegramThreadId = 42
}: {
  telegramThreadId?: number | null;
} = {}) {
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: telegramThreadId
                  ? { telegram_thread_id: telegramThreadId, contact_name: null, contact_company: null }
                  : { telegram_thread_id: null, contact_name: null, contact_company: null },
                error: null
              }))
            }))
          })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          insert: vi.fn(async () => ({ error: null }))
        };
      }
      if (table === 'leads') {
        return {
          insert: vi.fn(async () => ({ error: null }))
        };
      }
      return {
        insert: vi.fn(async () => ({ error: null })),
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
      };
    })
  };

  return { client };
}

async function callFinalizeRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/leads/finalize/route');
  const req = new Request('http://localhost/api/leads/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return POST(req);
}

describe('POST /api/leads/finalize Telegram notifications', () => {
  beforeEach(() => {
    hasSupabaseServerConfigMock.mockReturnValue(true);
    enqueueHandoffMock.mockReset();
    enqueueHandoffMock.mockImplementation(async () => ({ persisted: true, queued: true, delivered: false, retryable: false, handoffId: 'ho-test-123' }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('enqueues a handoff with project summary on approve', async () => {
    const { client } = buildMockSupabase({ telegramThreadId: 42 });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '11111111-2222-3333-4444-555555555555',
      qualificationStatus: 'qualified',
      score: 8,
      recommendedNextStep: 'production',
      leadDraft: {
        service: 'production',
        projectType: 'Video',
        projectScope: '30s animation for social media',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'Jayden',
        contactEmail: 'jayden@example.com'
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.persisted).toBe(true);
    expect(data.queued).toBe(true);

    expect(enqueueHandoffMock).toHaveBeenCalledTimes(1);
    const handoffPayload = enqueueHandoffMock.mock.calls[0][1];
    expect(handoffPayload.type).toBe('approval');
    expect(handoffPayload.sessionId).toBe('11111111-2222-3333-4444-555555555555');
    expect(handoffPayload.threadId).toBe(42);
    expect(handoffPayload.summary).toContain('Brief approved');
    expect(handoffPayload.summary).toContain('Video');
    expect(handoffPayload.summary).toContain('30s animation for social media');
    expect(handoffPayload.summary).toContain('Jayden');
  });

  test('still enqueues when there are no attachments', async () => {
    const { client } = buildMockSupabase({ telegramThreadId: 99 });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '22222222-3333-4444-5555-666666666666',
      qualificationStatus: 'needs_review',
      leadDraft: {
        service: 'production',
        projectType: 'Animation',
        projectScope: 'event with 3 led screens',
        timelineBand: 'flexible',
        budgetBand: 'under-20k',
        contactName: 'Mei',
        contactEmail: 'mei@example.com'
      }
    });

    expect(res.status).toBe(200);
    expect(enqueueHandoffMock).toHaveBeenCalledTimes(1);
    const handoffPayload = enqueueHandoffMock.mock.calls[0][1];
    expect(handoffPayload.summary).toContain('event with 3 led screens');
    expect(handoffPayload.summary).not.toContain('Reference links:');
    expect(handoffPayload.summary).not.toContain('Reference files:');
  });

  test('includes reference links in handoff summary', async () => {
    const { client } = buildMockSupabase({ telegramThreadId: 7 });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '33333333-4444-5555-6666-777777777777',
      qualificationStatus: 'qualified',
      leadDraft: {
        service: 'production',
        projectType: 'Video',
        projectScope: '30s spot',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'Alex',
        contactEmail: 'alex@example.com',
        referenceLinks: [{ kind: 'youtube', url: 'https://youtu.be/abc' }]
      }
    });

    expect(res.status).toBe(200);
    expect(enqueueHandoffMock).toHaveBeenCalledTimes(1);
    const handoffPayload = enqueueHandoffMock.mock.calls[0][1];
    expect(handoffPayload.summary).toContain('Reference links:');
    expect(handoffPayload.summary).toContain('https://youtu.be/abc');
  });

  test('does NOT enqueue when there is no telegram thread', async () => {
    const { client } = buildMockSupabase({ telegramThreadId: null });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '44444444-5555-6666-7777-888888888888',
      qualificationStatus: 'qualified',
      leadDraft: {
        service: 'production',
        projectType: 'Video',
        projectScope: '30s spot',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'Sam',
        contactEmail: 'sam@example.com'
      }
    });

    expect(res.status).toBe(200);
    expect(enqueueHandoffMock).not.toHaveBeenCalled();
  });

  test('response includes queued and delivered status', async () => {
    const { client } = buildMockSupabase({ telegramThreadId: 11 });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
      qualificationStatus: 'qualified',
      leadDraft: {
        service: 'production',
        projectType: 'Video',
        projectScope: '30s spot',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'Sam',
        contactEmail: 'sam@example.com'
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.queued).toBe(true);
    expect(data.delivered).toBe(false);
    expect(data.handoffId).toBe('ho-test-123');
  });

  test('reports retryable when handoff fails', async () => {
    const { client } = buildMockSupabase({ telegramThreadId: 11 });
    createServerSupabaseClientMock.mockReturnValue(client);
    enqueueHandoffMock.mockImplementation(async () => ({
      persisted: true, queued: false, delivered: false, retryable: true, handoffId: 'ho-failed'
    }));

    const res = await callFinalizeRoute({
      sessionId: '88888888-9999-aaaa-bbbb-cccccccccccc',
      qualificationStatus: 'qualified',
      leadDraft: {
        service: 'production',
        projectType: 'Video',
        projectScope: '30s spot',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'Sam',
        contactEmail: 'sam@example.com'
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.queued).toBe(false);
    expect(data.retryable).toBe(true);
    expect(data.handoffId).toBe('ho-failed');
  });
});
