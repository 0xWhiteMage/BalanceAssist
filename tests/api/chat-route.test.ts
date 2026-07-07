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

  function makeMultiToolCallResponse(content: string, calls: Array<{ name: string; argumentsStr: string }>) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content,
            tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.argumentsStr } }))
          }
        }]
      })
    };
  }

  function makeTruncatedResponse(content: string, finishReason: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: { content },
          finish_reason: finishReason
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
      messages: [{ role: 'user', content: 'I have a 30s animation, my name is Tool' }],
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

  test('truncated response (finish_reason=length) returns the partial message verbatim and logs a warning', async () => {
    const partial = 'Balance Studio has shipped 110+ projects across APAC, working with clients like Heineken, ' +
      'Red Bull, and Visa. Their team includes directors, producers, cinematographers, animators, VFX artists, editors -';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    global.fetch = vi.fn(async () => makeTruncatedResponse(partial, 'length')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'Tell me everything about Balance Studio' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBe(partial);
    expect(warnSpy).toHaveBeenCalledWith('[chat] response truncated: finish_reason=length');

    warnSpy.mockRestore();
  });

  test('share_work tool call returns sharedWork.entries with the resolved work data', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'A few examples of our event work:',
      'share_work',
      JSON.stringify({ slugs: ['milo', 'razer', 'msi'], category: 'reference' })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'show me event examples' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBe('A few examples of our event work:');
    expect(data.sharedWork).toBeDefined();
    expect(data.sharedWork.entries).toHaveLength(3);
    const slugs = data.sharedWork.entries.map((e: { slug: string }) => e.slug);
    expect(slugs).toEqual(['milo', 'razer', 'msi']);
    expect(data.sharedWork.entries[0].category).toBe('reference');
    expect(data.sharedWork.entries[0].title).toBe('MILO — Energy and the Spirit to Success');
    expect(data.sharedWork.entries[0].url).toMatch(/balancestudio\.tv\/milo/);
    expect(data.sharedWork.entries[0].image_url).toMatch(/squarespace-cdn/);
  });

  test('share_work tool call drops invalid slugs and caps the result at 8 entries', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'Here are a few pieces.',
      'share_work',
      JSON.stringify({
        slugs: [
          'milo',
          'razer',
          'msi',
          'handshakes',
          'compare-club',
          'filmninja',
          'sccc5x',
          'sccc-kaki-says',
          'made-up-slug',
          'sph-the-future-of-skills'
        ],
        category: 'pitch'
      })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'show me your video work' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.sharedWork.entries.length).toBe(8);
    const slugs = data.sharedWork.entries.map((e: { slug: string }) => e.slug);
    expect(slugs).not.toContain('made-up-slug');
    expect(data.sharedWork.entries[0].category).toBe('pitch');
  });

  test('share_work tool call with no valid slugs returns no sharedWork', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'Nothing to show.',
      'share_work',
      JSON.stringify({ slugs: ['nope-1', 'nope-2'], category: 'reference' })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'show me your stuff' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.sharedWork).toBeUndefined();
  });

  test('record_brief_updates and share_work in the same response populate both fields', async () => {
    global.fetch = vi.fn(async () => makeMultiToolCallResponse(
      'Updated your brief.',
      [
        {
          name: 'record_brief_updates',
          argumentsStr: JSON.stringify({
            service: 'production',
            projectType: 'Video',
            projectScope: '30s animation',
            scopePolished: '30s animation',
            timelineBand: '1-2-months',
            budgetBand: '20k-50k',
            contactEmail: 'tool@example.com',
            contactName: 'Tool',
            contactCompany: ''
          })
        },
        {
          name: 'share_work',
          argumentsStr: JSON.stringify({ slugs: ['milo'], category: 'mood' })
        }
      ]
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: '30s animation with mood reference, my name is Tool' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.draftUpdates.contactName).toBe('Tool');
    expect(data.briefReady).toBe(true);
    expect(data.sharedWork).toBeDefined();
    expect(data.sharedWork.entries).toHaveLength(1);
    expect(data.sharedWork.entries[0].category).toBe('mood');
  });

  test('fabrication guard strips a hallucinated contactName when the user message is only about scope', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'Got it.',
      'record_brief_updates',
      JSON.stringify({
        service: 'production',
        projectType: 'Video',
        projectScope: '30s animation',
        scopePolished: '',
        timelineBand: '',
        budgetBand: '',
        contactEmail: '',
        contactName: 'Whatever',
        contactCompany: ''
      })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'yes, an event video' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.draftUpdates.contactName).toBe('');
    expect(data.draftUpdates.projectScope).toBe('30s animation');
    expect(data.briefReady).toBe(false);
  });
});
