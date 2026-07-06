import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

describe('POST /api/chat', () => {
  let originalFetch: typeof fetch;
  let originalDeepseekKey: string | undefined;
  let originalDeepseekModel: string | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalDeepseekKey = process.env.DEEPSEEK_API_KEY;
    originalDeepseekModel = process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_MODEL;
  });

  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
    process.env.DEEPSEEK_MODEL = originalDeepseekModel;
    global.fetch = originalFetch;
  });

  function makeToolCallResponse(content: string, name: string, argumentsStr: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content,
            tool_calls: [{ function: { name, arguments: argumentsStr } }]
          }
        }]
      })
    };
  }

  async function postChat(body: unknown) {
    const { POST } = await import('@/app/api/chat/route');
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const res = await POST(req);
    return { res, data: await res.json() };
  }

  test('returns draft updates, briefReady, and reviewPrompt from a tool call', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'Got it.',
      'record_brief_updates',
      JSON.stringify({
        service: 'production',
        projectScope: '30s animation',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactEmail: 'tool@example.com',
        contactName: 'Tool',
        contactCompany: '',
        projectType: 'Video',
        scopePolished: '30s animation'
      })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'I have a 30s animation' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBe('Got it.');
    expect(data.draftUpdates.contactName).toBe('Tool');
    expect(data.briefReady).toBe(true);
    expect(data.reviewPrompt).toBe('Your brief is ready. Tap the tab on the right to review.');
    expect(data.missingFields).toEqual([]);
  });

  test('ignores tool call with wrong function name (no toolArguments, no briefReady)', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'Just chatting.',
      'some_other_tool',
      JSON.stringify({ service: 'production' })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'hello' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBe('Just chatting.');
    expect(data.draftUpdates).toEqual({});
    expect(data.briefReady).toBe(false);
    expect(data.reviewPrompt).toBeNull();
  });

  test('ignores tool call with malformed JSON arguments (no toolArguments)', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'Hello there.',
      'record_brief_updates',
      '{ this is not valid json'
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'hello' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.draftUpdates).toEqual({});
    expect(data.briefReady).toBe(false);
    expect(data.reviewPrompt).toBeNull();
  });

  test('ignores tool call that fails safeParse (bad contactEmail) (no toolArguments)', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'Trying something.',
      'record_brief_updates',
      JSON.stringify({
        service: 'production',
        projectScope: '30s animation',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactEmail: 'bad',
        contactName: 'Tool',
        contactCompany: '',
        projectType: 'Video',
        scopePolished: '30s animation'
      })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'hello' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.draftUpdates).toEqual({});
    expect(data.briefReady).toBe(false);
    expect(data.reviewPrompt).toBeNull();
  });

  test('returns local fallback response when no API key is set', async () => {
    global.fetch = vi.fn();

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'I have a 30s animation' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBeTypeOf('string');
    expect(data.message.length).toBeGreaterThan(0);
    expect(data.draftUpdates).toEqual({});
    expect(data.briefReady).toBe(false);
    expect(data.reviewPrompt).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
