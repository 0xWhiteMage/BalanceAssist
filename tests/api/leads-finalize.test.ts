// @vitest-environment node
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const {
  sendTelegramMessageMock,
  editForumTopicMock,
  ensureTelegramTopicMock,
  hasSupabaseServerConfigMock,
  createServerSupabaseClientMock,
  enqueueHandoffMock,
  requireSessionMock
} = vi.hoisted(() => ({
  sendTelegramMessageMock: vi.fn(async () => ({ messageId: 1 })),
  editForumTopicMock: vi.fn(async () => true),
  ensureTelegramTopicMock: vi.fn(async () => null),
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn(),
  enqueueHandoffMock: vi.fn(async () => ({ persisted: true, queued: true, delivered: false, retryable: false, handoffId: 'ho-test-123' })),
  requireSessionMock: vi.fn()
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

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

function buildMockSupabase({
  telegramThreadId = 42,
  draft = {
    service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
    projectType: { value: 'Video', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
    projectScope: { value: '30s spot', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
    timelineBand: { value: '1-2-months', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
    budgetBand: { value: '20k-50k', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
    contactName: { value: 'Sam', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
    contactEmail: { value: 'sam@example.com', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' }
  },
  draftVersion = 3,
  referenceLinks = [],
  referenceFiles = [],
  leadInsertError = null,
  consentTransitions = [{ scope: 'producer_transfer', granted: true }]
}: {
  telegramThreadId?: number | null;
  draft?: Record<string, unknown>;
  draftVersion?: number;
  referenceLinks?: Array<{ url: string; kind?: string }>;
  referenceFiles?: Array<{ original_name: string }>;
  leadInsertError?: { message: string } | null;
  consentTransitions?: Array<{ scope: string; granted: boolean }>;
} = {}) {
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  telegram_thread_id: telegramThreadId,
                  contact_name: null,
                  contact_company: null,
                  draft,
                  draft_version: draftVersion
                },
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
          insert: vi.fn(async () => ({ error: leadInsertError }))
        };
      }
      if (table === 'reference_links') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: referenceLinks, error: null }))
          }))
        };
      }
      if (table === 'uploaded_files') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: referenceFiles, error: null }))
          }))
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
        insert: vi.fn(async () => ({ error: null })),
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
      };
    })
  };

  return { client };
}

async function callFinalizeRoute(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/leads/finalize/route');
  const req = new Request('http://localhost/api/leads/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'https://www.balancestudio.tv', ...headers },
    body: JSON.stringify(body)
  });
  return POST(req);
}

describe('POST /api/leads/finalize Telegram notifications', () => {
  beforeEach(() => {
    hasSupabaseServerConfigMock.mockReturnValue(true);
    enqueueHandoffMock.mockReset();
    enqueueHandoffMock.mockImplementation(async () => ({ persisted: true, queued: true, delivered: false, retryable: false, handoffId: 'ho-test-123' }));
    requireSessionMock.mockReset();
    requireSessionMock.mockImplementation(async (_request: Request, expectedSessionId?: string) => ({
      ok: true,
      auth: {
        sessionId: expectedSessionId && expectedSessionId.length > 0
          ? expectedSessionId
          : '11111111-2222-3333-4444-555555555555',
        capability: 'session-capability'
      },
      supabase: createServerSupabaseClientMock()
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('enqueues a handoff with project summary on approve using canonical draft, not browser leadDraft', async () => {
    const { client } = buildMockSupabase({ telegramThreadId: 42 });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '11111111-2222-3333-4444-555555555555',
      qualificationStatus: 'qualified',
      score: 8,
      recommendedNextStep: 'production',
      leadDraft: {
        service: 'production',
        projectType: 'ATTACKER-VALUE',
        projectScope: 'ATTACKER SCOPE',
        timelineBand: 'attacker',
        budgetBand: 'attacker',
        contactName: 'Attacker',
        contactEmail: 'attacker@evil.com'
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.persisted).toBe(true);
    expect(data.queued).toBe(true);

    expect(enqueueHandoffMock).toHaveBeenCalledTimes(1);
    const handoffPayload = (enqueueHandoffMock.mock.calls as unknown[][])[0]![1] as { type: string; sessionId: string; threadId: number; summary: string };
    expect(handoffPayload.type).toBe('approval');
    expect(handoffPayload.sessionId).toBe('11111111-2222-3333-4444-555555555555');
    expect(handoffPayload.threadId).toBe(42);
    expect(handoffPayload.summary).toContain('Service: production');
    expect(handoffPayload.summary).toContain('Video');
    expect(handoffPayload.summary).toContain('30s spot');
    expect(handoffPayload.summary).toContain('Sam');
    expect(handoffPayload.summary).not.toContain('ATTACKER');
  });

  test('still enqueues when there are no attachments', async () => {
    const { client } = buildMockSupabase({
      telegramThreadId: 99,
      draft: {
        service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        projectType: { value: 'Animation', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        projectScope: { value: 'event with 3 led screens', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        timelineBand: { value: 'flexible', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        budgetBand: { value: 'under-20k', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        contactName: { value: 'Mei', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        contactEmail: { value: 'mei@example.com', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' }
      }
    });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '22222222-3333-4444-5555-666666666666',
      qualificationStatus: 'needs_review',
      leadDraft: {}
    });

    expect(res.status).toBe(200);
    expect(enqueueHandoffMock).toHaveBeenCalledTimes(1);
    const handoffPayload = (enqueueHandoffMock.mock.calls as unknown[][])[0]![1] as { summary: string };
    expect(handoffPayload.summary).toContain('event with 3 led screens');
    expect(handoffPayload.summary).not.toContain('Reference links:');
    expect(handoffPayload.summary).not.toContain('Reference files:');
  });

  test('includes reference links from the database, not the browser payload', async () => {
    const { client } = buildMockSupabase({
      telegramThreadId: 7,
      draft: {
        service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        projectType: { value: 'Video', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        projectScope: { value: '30s spot', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        timelineBand: { value: '1-2-months', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        budgetBand: { value: '20k-50k', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        contactName: { value: 'Sam', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        contactEmail: { value: 'sam@example.com', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        __attachment_producer_share_consented_at: {
          value: '2026-07-11T10:00:00.000Z',
          provenance: 'confirmed',
          updatedAt: '2026-07-11T10:00:00.000Z'
        }
      },
      referenceLinks: [{ url: 'https://youtu.be/canonical', kind: 'youtube' }]
    });
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
        referenceLinks: [{ kind: 'youtube', url: 'https://attacker.com/bad' }]
      }
    });

    expect(res.status).toBe(200);
    expect(enqueueHandoffMock).toHaveBeenCalledTimes(1);
    const handoffPayload = (enqueueHandoffMock.mock.calls as unknown[][])[0]![1] as { summary: string };
    expect(handoffPayload.summary).toContain('Links:');
    expect(handoffPayload.summary).toContain('https://youtu.be/canonical');
    expect(handoffPayload.summary).not.toContain('attacker.com');
  });

  test('does not include links or files in the handoff packet when producer-share was not recorded server-side', async () => {
    const { client } = buildMockSupabase({
      telegramThreadId: 7,
      draft: {
        service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        projectType: { value: 'Video', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        projectScope: { value: '30s spot', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        timelineBand: { value: '1-2-months', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        budgetBand: { value: '20k-50k', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        contactName: { value: 'Sam', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        contactEmail: { value: 'sam@example.com', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        __attachment_ai_analysis_consented_at: {
          value: '2026-07-11T10:00:00.000Z',
          provenance: 'confirmed',
          updatedAt: '2026-07-11T10:00:00.000Z'
        }
      },
      referenceLinks: [{ url: 'https://youtu.be/private-analysis-only', kind: 'youtube' }],
      referenceFiles: [{ original_name: 'analysis-only.pdf' }],
      consentTransitions: []
    });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '39333333-4444-5555-6666-777777777777',
      qualificationStatus: 'qualified',
      leadDraft: {
        service: 'production',
        projectType: 'Video',
        projectScope: '30s spot',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'Alex',
        contactEmail: 'alex@example.com'
      }
    });

    expect(res.status).toBe(200);
    expect(enqueueHandoffMock).toHaveBeenCalledTimes(1);
    const handoffPayload = (enqueueHandoffMock.mock.calls as unknown[][])[0]![1] as { summary: string };
    expect(handoffPayload.summary).not.toContain('private-analysis-only');
    expect(handoffPayload.summary).not.toContain('analysis-only.pdf');
  });

  test('does not let a forged draft consent field authorize producer transfer', async () => {
    const { client } = buildMockSupabase({
      draft: {
        service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        projectScope: { value: '30s spot', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        contactName: { value: 'Sam', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        contactEmail: { value: 'sam@example.com', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
        __attachment_producer_share_consented_at: { value: 'forged', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' }
      },
      referenceLinks: [{ url: 'https://attacker.test/link', kind: 'other' }],
      consentTransitions: []
    });
    createServerSupabaseClientMock.mockReturnValue(client);

    const response = await callFinalizeRoute({
      sessionId: '77777777-4444-5555-6666-777777777777',
      qualificationStatus: 'qualified',
      leadDraft: {}
    });

    expect(response.status).toBe(200);
    const handoffPayload = (enqueueHandoffMock.mock.calls as unknown[][])[0]![1] as { summary: string };
    expect(handoffPayload.summary).not.toContain('attacker.test');
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

  test('returns a non-2xx failure and does not enqueue when lead persistence fails', async () => {
    const { client } = buildMockSupabase({
      telegramThreadId: 11,
      leadInsertError: { message: 'insert failed' }
    });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '77777777-8888-9999-aaaa-bbbbbbbbbbbb',
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

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.persisted).toBe(false);
    expect(data.error).toContain('insert failed');
    expect(enqueueHandoffMock).not.toHaveBeenCalled();
  });

  test('records consentToShare on the canonical draft during finalize', async () => {
    const updateCalls: Array<{ table: string; args: unknown[] }> = [];
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    telegram_thread_id: 42,
                    contact_name: null,
                    contact_company: null,
                    draft: {
                      service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      projectType: { value: 'Video', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      projectScope: { value: '30s spot', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      timelineBand: { value: '1-2-months', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      budgetBand: { value: '20k-50k', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      contactName: { value: 'Sam', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      contactEmail: { value: 'sam@example.com', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' }
                    },
                    draft_version: 3
                  },
                  error: null
                }))
              }))
            })),
            update: vi.fn((row: Record<string, unknown>) => {
              updateCalls.push({ table, args: [row] });
              return { eq: vi.fn(async () => ({ error: null })) };
            }),
            insert: vi.fn(async () => ({ error: null }))
          };
        }
        if (table === 'leads') {
          return {
            insert: vi.fn((row: Record<string, unknown>) => {
              inserts.push({ table, row });
              return Promise.resolve({ error: null });
            })
          };
        }
        if (table === 'reference_links') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [], error: null }))
            }))
          };
        }
        if (table === 'uploaded_files') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [], error: null }))
            }))
          };
        }
        if (table === 'session_consents') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [], error: null })) })) })) };
        }
        return {};
      })
    };
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '11111111-2222-3333-4444-555555555555',
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

    expect(updateCalls.some((call) => 'draft' in (call.args[0] as Record<string, unknown>))).toBe(false);
  });

  test('skips persistence when canonical draft has no substance', async () => {
    const { client } = buildMockSupabase({
      telegramThreadId: 42,
      draft: {}
    });
    createServerSupabaseClientMock.mockReturnValue(client);

    const res = await callFinalizeRoute({
      sessionId: '11111111-2222-3333-4444-555555555555',
      qualificationStatus: 'qualified',
      leadDraft: {
        service: 'production',
        projectType: 'Video',
        projectScope: 'browser-only data',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'Attacker',
        contactEmail: 'attacker@evil.com'
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.persisted).toBe(false);
    expect(enqueueHandoffMock).not.toHaveBeenCalled();
  });

  test('uses database lead record from canonical draft values, ignoring browser leadDraft', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    telegram_thread_id: 42,
                    contact_name: null,
                    contact_company: null,
                    draft: {
                      service: { value: 'production', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      projectType: { value: 'Video', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      projectScope: { value: '30s spot', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      timelineBand: { value: '1-2-months', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      budgetBand: { value: '20k-50k', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      contactName: { value: 'Sam', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' },
                      contactEmail: { value: 'sam@example.com', provenance: 'confirmed', updatedAt: '2026-07-11T10:00:00.000Z' }
                    },
                    draft_version: 3
                  },
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
            insert: vi.fn((row: Record<string, unknown>) => {
              inserts.push({ table, row });
              return Promise.resolve({ error: null });
            })
          };
        }
        if (table === 'reference_links') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [], error: null }))
            }))
          };
        }
        if (table === 'uploaded_files') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [], error: null }))
            }))
          };
        }
        if (table === 'session_consents') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [{ scope: 'producer_transfer', granted: true }], error: null })) })) })) };
        }
        return {};
      })
    };
    createServerSupabaseClientMock.mockReturnValue(client);

    await callFinalizeRoute({
      sessionId: '11111111-2222-3333-4444-555555555555',
      qualificationStatus: 'qualified',
      leadDraft: {
        service: 'production',
        projectType: 'PWN',
        projectScope: 'PWN SCOPE',
        timelineBand: 'pwn',
        budgetBand: 'pwn',
        contactName: 'Pwn',
        contactEmail: 'pwn@evil.com'
      }
    });

    const leadInsert = inserts.find((i) => i.table === 'leads');
    expect(leadInsert).toBeDefined();

    const insertArg = leadInsert!.row;
    const draft = insertArg.lead_draft as Record<string, string | undefined>;
    expect(draft.contactName).toBe('Sam');
    expect(draft.contactEmail).toBe('sam@example.com');
    expect(draft.projectScope).toBe('30s spot');
    expect(insertArg.contact_name).toBe('Sam');
    expect(insertArg.contact_email).toBe('sam@example.com');
  });
});
