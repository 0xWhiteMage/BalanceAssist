// @vitest-environment node
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const { sendTelegramMessageMock, editForumTopicMock, hasSupabaseServerConfigMock, createServerSupabaseClientMock } = vi.hoisted(() => ({
  sendTelegramMessageMock: vi.fn(async () => ({ messageId: 1 })),
  editForumTopicMock: vi.fn(async () => true),
  hasSupabaseServerConfigMock: vi.fn(() => true),
  createServerSupabaseClientMock: vi.fn()
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: sendTelegramMessageMock,
  editForumTopic: editForumTopicMock
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

interface CapturedTelegramMessage {
  text: string;
  options?: { replyToMessageId?: number; threadId?: number };
}

interface CapturedTopicEdit {
  threadId: number;
  name: string;
  options?: { iconColor?: number };
}

const capturedMessages: CapturedTelegramMessage[] = [];
const capturedEdits: CapturedTopicEdit[] = [];

function buildMockSupabase({
  telegramThreadId = 42,
  withAttachmentLinks = false,
  withAttachmentFiles = false
}: {
  telegramThreadId?: number | null;
  withAttachmentLinks?: boolean;
  withAttachmentFiles?: boolean;
} = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];

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
        insert: vi.fn((row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        }),
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
      };
    })
  };

  return { client, inserts, withAttachmentLinks, withAttachmentFiles };
}

function attachSpyWrappers() {
  sendTelegramMessageMock.mockReset();
  editForumTopicMock.mockReset();
  capturedMessages.length = 0;
  capturedEdits.length = 0;
  sendTelegramMessageMock.mockImplementation(async (text, options) => {
    capturedMessages.push({ text, options });
    return { messageId: 1 };
  });
  editForumTopicMock.mockImplementation(async (threadId, name, options) => {
    capturedEdits.push({ threadId, name, options });
    return true;
  });
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
    attachSpyWrappers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('always sends a Telegram message with project type, scope, timeline, budget and contact on approve', async () => {
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

    expect(editForumTopicMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);

    expect(capturedMessages).toHaveLength(1);
    const msg = capturedMessages[0];
    expect(msg.options?.threadId).toBe(42);
    expect(msg.text).toContain('Brief approved');
    expect(msg.text).toContain('Project type:');
    expect(msg.text).toContain('Video');
    expect(msg.text).toContain('Scope:');
    expect(msg.text).toContain('30s animation for social media');
    expect(msg.text).toContain('Timeline:');
    expect(msg.text).toContain('1-2-months');
    expect(msg.text).toContain('Budget:');
    expect(msg.text).toContain('20k-50k');
    expect(msg.text).toContain('Contact:');
    expect(msg.text).toContain('Jayden');
    expect(msg.text).toContain('jayden@example.com');
  });

  test('still posts a Telegram approval notification when there are no attachments', async () => {
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
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    expect(capturedMessages[0].options?.threadId).toBe(99);
    expect(capturedMessages[0].text).toContain('event with 3 led screens');
    expect(capturedMessages[0].text).not.toContain('Reference links:');
    expect(capturedMessages[0].text).not.toContain('Reference files:');
  });

  test('appends Reference links section when reference links are present', async () => {
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
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    expect(capturedMessages[0].text).toContain('Reference links:');
    expect(capturedMessages[0].text).toContain('https://youtu.be/abc');
  });

  test('does NOT send a Telegram message if there is no telegram thread', async () => {
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
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });
});
