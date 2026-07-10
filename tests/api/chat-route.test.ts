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

  test('when timelineBand is already captured, the LLM system prompt does NOT include the timeline question', async () => {
    let capturedSystemPrompt = '';
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const systemMessage = body.messages?.find((m: { role: string }) => m.role === 'system');
      capturedSystemPrompt = systemMessage?.content ?? '';
      return makeToolCallResponse(
        'Got it — what budget range works for you?',
        'record_brief_updates',
        JSON.stringify({
          service: 'production',
          projectType: 'Video',
          projectScope: '30s animation',
          scopePolished: '30s animation',
          timelineBand: '3 weeks',
          budgetBand: '',
          contactEmail: '',
          contactName: '',
          contactCompany: ''
        })
      );
    }) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res } = await postChat({
      messages: [{ role: 'user', content: '3 weeks timeline, my name is Jayden' }],
      context: {
        step: 'timeline',
        draft: JSON.stringify({
          service: 'production',
          projectType: 'Video',
          projectScope: '30s animation',
          timelineBand: '3 weeks'
        }),
        capturedFields: ['projectScope', 'projectType', 'service', 'timelineBand']
      }
    });

    expect(res.status).toBe(200);
    // The LLM system prompt must include the captured-fields summary.
    expect(capturedSystemPrompt).toMatch(/ALREADY CAPTURED/i);
    expect(capturedSystemPrompt).toMatch(/timelineBand\s*=\s*3 weeks/);
    // The LLM system prompt must NOT include the timeline question text,
    // because that field is already captured.
    expect(capturedSystemPrompt).not.toMatch(/What timeline are you working with\?/);
  });

  test('when no fields are captured, the LLM system prompt includes the first-question template (full list)', async () => {
    let capturedSystemPrompt = '';
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const systemMessage = body.messages?.find((m: { role: string }) => m.role === 'system');
      capturedSystemPrompt = systemMessage?.content ?? '';
      return makeToolCallResponse(
        "Got it. Tell me about the project.",
        'record_brief_updates',
        JSON.stringify({
          service: '',
          projectScope: '',
          timelineBand: '',
          budgetBand: '',
          contactEmail: '',
          contactName: '',
          contactCompany: '',
          projectType: ''
        })
      );
    }) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res } = await postChat({
      messages: [{ role: 'user', content: 'I want to talk about a project' }],
      context: {
        step: 'intro',
        draft: '{}',
        capturedFields: []
      }
    });

    expect(res.status).toBe(200);
    // No ALREADY CAPTURED line when nothing is captured.
    expect(capturedSystemPrompt).not.toMatch(/ALREADY CAPTURED/i);
    // The full template of next-question rules is present so the LLM can pick the right one.
    expect(capturedSystemPrompt).toMatch(/What timeline are you working with\?/);
  });

  test('capturedFields is optional in the request schema', async () => {
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
        contactCompany: 'Acme',
        projectType: 'Video',
        scopePolished: '30s animation'
      })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'I have a 30s animation for Acme, my name is Tool, email tool@example.com' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.briefReady).toBe(true);
  });

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
        contactCompany: 'Acme',
        projectType: 'Video',
        scopePolished: '30s animation'
      })
    )) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'I have a 30s animation for Acme, my name is Tool, email tool@example.com' }],
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

  test('answers filming FAQs deterministically with messages[] and sharedWork without calling the LLM', async () => {
    global.fetch = vi.fn();
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'can you do filming?' }],
      context: { step: 'intro', draft: '{}', isTeamConnected: false }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBeUndefined();
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0]).toMatch(/production is one of our core service pillars/i);
    expect(data.sharedWork.entries.length).toBeGreaterThan(0);
    expect(data.sharedWork.entries.length).toBeLessThanOrEqual(5);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('truncated response (finish_reason=length) prefixes the partial with "(continuing…)" and sets truncated=true', async () => {
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
    expect(data.truncated).toBe(true);
    expect(Array.isArray(data.messages)).toBe(true);
    expect((data.messages as string[])[0]).toBe('(continuing…)');
    expect((data.messages as string[])[1]).toBe(partial);
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
            contactCompany: 'Acme'
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
      messages: [{ role: 'user', content: '30s animation for Acme with mood reference, my name is Tool, email tool@example.com' }],
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

  test('splits a reply with double-newline separators into a messages[] array', async () => {
    global.fetch = vi.fn(async () => makeTruncatedResponse('Hello.\n\nThere.\n\nFriend.', 'stop')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'say something with three bubbles' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBeUndefined();
    expect(data.messages).toEqual(['Hello.', 'There.', 'Friend.']);
  });

  test('splits a reply with --- separators into a messages[] array', async () => {
    global.fetch = vi.fn(async () => makeTruncatedResponse('Hello.\n---\nThere.\n---\nFriend.', 'stop')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'three bubbles with rules' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBeUndefined();
    expect(data.messages).toEqual(['Hello.', 'There.', 'Friend.']);
  });

  test('keeps the single-message shape when there are no separators (backwards-compatible)', async () => {
    global.fetch = vi.fn(async () => makeTruncatedResponse('Just one short reply.', 'stop')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'short reply please' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBe('Just one short reply.');
    expect(data.messages).toBeUndefined();
  });

  test('sharedWork and briefReady stay attached to the FIRST message in the split array', async () => {
    global.fetch = vi.fn(async () => makeToolCallResponse(
      'A few examples:\n\nWant me to walk through the event pieces?',
      'share_work',
      JSON.stringify({ slugs: ['milo', 'razer'], category: 'reference' })
    )) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'show me event examples' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.messages).toEqual(['A few examples:', 'Want me to walk through the event pieces?']);
    expect(data.sharedWork).toBeDefined();
    expect(data.sharedWork.entries).toHaveLength(2);
    expect(data.briefReady).toBe(false);
  });

  test('splits a Deepseek reply with --- on its own line (with surrounding whitespace) into 3 bubbles', async () => {
    global.fetch = vi.fn(async () => makeTruncatedResponse(
      'First thought.\n\n---\n\nSecond thought.\n\n---\n\nThird thought.',
      'stop'
    )) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'three bubbles please' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBeUndefined();
    expect(data.messages).toEqual(['First thought.', 'Second thought.', 'Third thought.']);
    expect(data.truncated).toBe(false);
  });

  test('truncated single-bubble reply emits messages[] whose first element starts with "(continuing…)"', async () => {
    global.fetch = vi.fn(async () => makeTruncatedResponse('partial', 'length')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'short reply please' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.truncated).toBe(true);
    expect(Array.isArray(data.messages)).toBe(true);
    expect((data.messages as string[])[0]).toMatch(/^\(continuing…\)/);
  });

  test('single-bubble reply with no separators returns the message field (not messages[])', async () => {
    global.fetch = vi.fn(async () => makeTruncatedResponse('partial', 'stop')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'short reply please' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBe('partial');
    expect(data.messages).toBeUndefined();
    expect(data.truncated).toBe(false);
  });

  test('5-paragraph response is capped at 4 bubbles (first 3 plus a combined tail)', async () => {
    const longReply = 'One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.';
    global.fetch = vi.fn(async () => makeTruncatedResponse(longReply, 'stop')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'long answer please' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBeUndefined();
    expect(Array.isArray(data.messages)).toBe(true);
    const bubbles = data.messages as string[];
    expect(bubbles).toHaveLength(4);
    expect(bubbles[0]).toBe('One.');
    expect(bubbles[1]).toBe('Two.');
    expect(bubbles[2]).toBe('Three.');
    expect(bubbles[3]).toContain('Four.');
    expect(bubbles[3]).toContain('Five.');
  });

  test('1-paragraph response returns a single message field (no messages[] array)', async () => {
    global.fetch = vi.fn(async () => makeTruncatedResponse('Just one paragraph.', 'stop')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'brief' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBe('Just one paragraph.');
    expect(data.messages).toBeUndefined();
  });

  test('replies using --- with more than 4 segments are also capped at 4 bubbles', async () => {
    const reply = 'A.\n\n---\n\nB.\n\n---\n\nC.\n\n---\n\nD.\n\n---\n\nE.';
    global.fetch = vi.fn(async () => makeTruncatedResponse(reply, 'stop')) as unknown as typeof fetch;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { res, data } = await postChat({
      messages: [{ role: 'user', content: 'five explicit bubbles' }],
      context: { step: 'intro', draft: '{}' }
    });

    expect(res.status).toBe(200);
    expect(data.message).toBeUndefined();
    const bubbles = data.messages as string[];
    expect(bubbles).toHaveLength(4);
    expect(bubbles[bubbles.length - 1]).toContain('E.');
  });
});
