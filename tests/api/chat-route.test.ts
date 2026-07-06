import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

describe('POST /api/chat', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('returns draft updates, briefReady, and reviewPrompt from a tool call', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: 'Got it.',
            tool_calls: [{
              function: { name: 'record_brief_updates', arguments: JSON.stringify({
                service: 'production',
                projectScope: '30s animation',
                timelineBand: '1-2-months',
                budgetBand: '20k-50k',
                contactEmail: 'tool@example.com',
                contactName: 'Tool',
                contactCompany: '',
                projectType: 'Video',
                scopePolished: '30s animation'
              }) }
            }]
          }
        }]
      })
    })) as unknown as typeof fetch;

    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';

    const { POST } = await import('@/app/api/chat/route');
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'I have a 30s animation' }],
        context: { step: 'intro', draft: '{}' }
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe('Got it.');
    expect(data.draftUpdates.contactName).toBe('Tool');
    expect(data.briefReady).toBe(true);
    expect(data.reviewPrompt).toBe('Your brief is ready. Tap the tab on the right to review.');
    expect(data.missingFields).toEqual([]);
  });
});