// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WidgetOverlay } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // no-op for jsdom
    };
  }
});

afterEach(() => {
  global.fetch = originalFetch;
});

function chatSessionResponse() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/chat') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          message: 'Got it.',
          draftUpdates: {},
          briefReady: false,
          reviewPrompt: null,
          missingFields: []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/api/sessions')) {
      return new Response(
        JSON.stringify({ sessionId: 'mock-session', persisted: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/api/events')) {
      return new Response('{}', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

async function startAiConversation() {
  fireEvent.click(await screen.findByRole('button', { name: 'Build a brief with AI' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue with AI' }));

  const input = (await waitFor(() => {
    const el = screen.getByPlaceholderText(/Type your message|Message the team/i) as HTMLInputElement;
    expect(el).toBeInTheDocument();
    return el;
  }, { timeout: 4000 })) as HTMLInputElement;

  await waitFor(() => {
    expect(screen.getByRole('dialog', { name: /balance assist/i }).textContent).toMatch(/what can i help you with today\?/i);
  }, { timeout: 7000 });

  return input;
}

describe('WidgetOverlay brief rail gating (Fix 4)', () => {
  test('ignores a deferred normal response after AI processing moves to human-only contact', async () => {
    const pendingChat = deferred<Response>();
    const requests: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/api/chat') && init?.method === 'POST') return pendingChat.promise;
      if (url.includes('/consent')) {
        return new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 });
      }
      if (url.includes('/api/sessions')) {
        return new Response(JSON.stringify({ sessionId: 'mock-session', persisted: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();
    fireEvent.change(input, { target: { value: 'Tell me about a launch film' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(requests.filter((url) => url.includes('/api/chat'))).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /talk to a human/i }));
    await screen.findByPlaceholderText(/message the team request/i);

    await act(async () => {
      pendingChat.resolve(new Response(JSON.stringify({
        message: 'STALE NORMAL RESPONSE',
        draftUpdates: { service: 'production', projectScope: 'Stale scope' },
        briefReady: false
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await pendingChat.promise;
      await Promise.resolve();
    });

    expect(screen.queryByText('STALE NORMAL RESPONSE')).toBeNull();
    expect(screen.queryByTestId('review-rail')).toBeNull();
  }, 15_000);

  test('cancels a delayed AI bot message when processing moves to human-only contact', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/chat') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          message: 'STALE DELAYED AI REPLY',
          draftUpdates: {},
          briefReady: false
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/consent')) {
        return new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 });
      }
      if (url.includes('/api/sessions')) {
        return new Response(JSON.stringify({ sessionId: 'mock-session', persisted: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();
    fireEvent.change(input, { target: { value: 'Tell me something ordinary' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('status', { name: /balance assist is typing/i });

    fireEvent.click(screen.getByRole('button', { name: /talk to a human/i }));
    await screen.findByPlaceholderText(/message the team request/i);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    expect(screen.queryByText('STALE DELAYED AI REPLY')).toBeNull();
  }, 15_000);

  test('moves a confidential diversion to human-only contact without retrying or relaying blocked history', async () => {
    const secret = 'Project NIGHTJAR is under NDA';
    const requests: Array<{ url: string; body: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: String(init?.body ?? '') });
      if (url.includes('/api/chat') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          message: 'This channel cannot process confidential or sensitive material. Please use the human-only path to talk to the Balance team.',
          outcome: 'confidential_diversion',
          draftUpdates: {},
          briefReady: false
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/consent')) {
        return new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/api/telegram/relay')) {
        return new Response(JSON.stringify({ ok: true, persisted: true, queued: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/api/telegram/messages')) {
        return new Response(JSON.stringify({
          outgoingStatus: null,
          messages: [],
          fileRequestOpen: false,
          fileRequestNote: null,
          scheduleRequestOpen: false
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/sessions')) {
        return new Response(JSON.stringify({ sessionId: 'mock-session', persisted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText(/this channel cannot process confidential or sensitive material/i, {}, { timeout: 5000 })).toBeVisible();
    const humanInput = await screen.findByPlaceholderText(/message the team request/i, {}, { timeout: 5000 });
    const chatRequests = () => requests.filter((request) => request.url.includes('/api/chat'));
    const relayRequests = () => requests.filter((request) => request.url.includes('/api/telegram/relay'));
    expect(chatRequests()).toHaveLength(1);
    expect(relayRequests()).toHaveLength(0);

    fireEvent.change(humanInput, { target: { value: 'Please ask a producer to contact me.' } });
    fireEvent.keyDown(humanInput, { key: 'Enter' });

    await waitFor(() => expect(relayRequests()).toHaveLength(1));
    expect(chatRequests()).toHaveLength(1);
    expect(relayRequests()[0].body).toContain('Please ask a producer to contact me.');
    expect(relayRequests()[0].body).not.toContain(secret);
  }, 15_000);

  test('makes direct human contact usable while the request is pending without claiming the team is connected', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/consent')) return new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 });
      if (url.includes('/api/sessions')) return new Response(JSON.stringify({ sessionId: 'mock-session', persisted: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Talk to the team without AI' }));

    const input = await screen.findByPlaceholderText(/message the team request/i);
    expect(screen.queryByText(/^team connected$/i)).toBeNull();
    fireEvent.change(input, { target: { value: 'Please call me' } });
    expect(input).toHaveValue('Please call me');
  });

  test('typing an out-of-scope "draft text for my homework" message does NOT open the brief rail', async () => {
    global.fetch = chatSessionResponse();

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    // No rail at the start.
    expect(screen.queryByTestId('review-rail')).toBeNull();

    fireEvent.change(input, { target: { value: 'can you help me draft text for my homework?' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Wait for the user's text to be cleared (indicating submit was accepted).
    await waitFor(() => {
      expect(input.value).toBe('');
    });

    // Give the async LLM flow time to settle, then assert the rail is still hidden.
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByTestId('review-rail')).toBeNull();
  });

  test('after an LLM tool-call returns service: "production", hasProjectIntent IS true and the rail mounts', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            message: 'Your brief is ready.',
            draftUpdates: {
              service: 'production',
              projectType: 'Animation',
              projectScope: '30s animation',
              scopePolished: '30s animation',
              timelineBand: '1-2-months',
              budgetBand: '20k-50k',
              contactName: 'Jayden',
              contactEmail: 'jayden@example.com'
            },
            briefReady: true,
            reviewPrompt: 'Your brief is ready.',
            missingFields: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/sessions')) {
        return new Response(
          JSON.stringify({ sessionId: 'mock-session', persisted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    fireEvent.change(input, { target: { value: 'I want a 30s 3D animation' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(
      () => {
        expect(screen.queryByTestId('review-rail')).not.toBeNull();
      },
      { timeout: 4000 }
    );
  });
});

describe('WidgetOverlay passes captured fields to /api/chat (Fix 1)', () => {
  test('request body includes capturedFields array (empty when no draft)', async () => {
    const chatBodies: Array<{ context: { capturedFields?: string[] } }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat') && init?.method === 'POST') {
        chatBodies.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            message: 'Got it. What is your timeline?',
            draftUpdates: {
              service: 'production',
              projectType: 'Video',
              projectScope: '30s animation',
              scopePolished: '30s animation'
            },
            briefReady: false,
            reviewPrompt: null,
            missingFields: ['timelineBand', 'budgetBand', 'contactName', 'contactEmail', 'contactCompany']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/sessions')) {
        return new Response(
          JSON.stringify({ sessionId: 'mock-session', persisted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/events')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    await waitFor(() => {
      expect(screen.getAllByText(/What can I help you with today\?/i).length).toBeGreaterThan(0);
    }, { timeout: 7000 });

    fireEvent.change(input, { target: { value: 'I want a 30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(chatBodies.length).toBeGreaterThan(0);
    }, { timeout: 4000 });

    // The /api/chat request body must always include capturedFields as an array.
    // On the first call, no fields have been captured yet.
    const ctx = chatBodies[0]?.context;
    expect(ctx).toBeDefined();
    expect(Array.isArray(ctx!.capturedFields)).toBe(true);
    // No fields captured yet on the first turn.
    expect(ctx!.capturedFields).toEqual([]);
  }, 10000);

  test('on subsequent /api/chat calls, capturedFields reflects the merged draft from previous LLM responses', async () => {
    const chatBodies: Array<{ context: { capturedFields?: string[] } }> = [];
    let callIndex = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat') && init?.method === 'POST') {
        callIndex += 1;
        chatBodies.push(JSON.parse(String(init.body)));
        if (callIndex === 1) {
          return new Response(
            JSON.stringify({
              message: 'Got it. What is your timeline?',
              draftUpdates: {
                service: 'production',
                projectType: 'Video',
                projectScope: '30s animation',
                scopePolished: '30s animation'
              },
              briefReady: false,
              reviewPrompt: null,
              missingFields: ['timelineBand', 'budgetBand', 'contactName', 'contactEmail', 'contactCompany']
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            message: 'Got it. What is your budget?',
            draftUpdates: {},
            briefReady: false,
            reviewPrompt: null,
            missingFields: ['timelineBand', 'budgetBand', 'contactName', 'contactEmail', 'contactCompany']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/sessions')) {
        return new Response(
          JSON.stringify({ sessionId: 'mock-session', persisted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/events')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    await waitFor(() => {
      expect(screen.getAllByText(/What can I help you with today\?/i).length).toBeGreaterThan(0);
    }, { timeout: 7000 });

    fireEvent.change(input, { target: { value: 'I want a 30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Wait for the LLM reply and the draft merge to complete.
    await waitFor(() => {
      expect(screen.getByText(/Got it\. What is your timeline\?/i)).toBeInTheDocument();
    }, { timeout: 4000 });

    // Now send another message; the captured fields should include
    // projectScope, projectType, and service because the LLM set them
    // on the previous turn and the widget merged them into the draft.
    fireEvent.change(input, { target: { value: 'next' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(chatBodies.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 4000 });

    const ctx2 = chatBodies[1]?.context;
    expect(ctx2).toBeDefined();
    expect(Array.isArray(ctx2!.capturedFields)).toBe(true);
    expect(ctx2!.capturedFields).toContain('projectScope');
    expect(ctx2!.capturedFields).toContain('projectType');
    expect(ctx2!.capturedFields).toContain('service');
    // Timeline, budget, contact still missing.
    expect(ctx2!.capturedFields).not.toContain('timelineBand');
    expect(ctx2!.capturedFields).not.toContain('budgetBand');
  }, 15000);

  test('chat requests only include browser user messages even after assistant replies exist', async () => {
    const chatBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat') && init?.method === 'POST') {
        chatBodies.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            message: 'Got it. Tell me more.',
            draftUpdates: {},
            briefReady: false,
            reviewPrompt: null,
            missingFields: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/sessions')) {
        return new Response(
          JSON.stringify({ sessionId: 'mock-session', persisted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/events')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    await waitFor(() => {
      expect(screen.getAllByText(/What can I help you with today\?/i).length).toBeGreaterThan(0);
    }, { timeout: 7000 });

    fireEvent.change(input, { target: { value: 'We need a launch film.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/Got it\. Tell me more\./i)).toBeInTheDocument();
    }, { timeout: 4000 });

    fireEvent.change(input, { target: { value: 'The audience is regional.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(chatBodies.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 4000 });

    expect(chatBodies[1]?.messages).toEqual([
      { role: 'user', content: 'We need a launch film.' },
      { role: 'user', content: 'The audience is regional.' }
    ]);
  }, 10000);
});

describe('project-scope auto-fill on user reply (Fix 5 regression)', () => {
  test('after the user types a project description and the LLM tool-call sets projectScope, the brief card renders the scope', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            message: "Got it — a brand film for Heineken. What's the format and length?",
            draftUpdates: {
              projectScope:
                "It's a brand film for Heineken — making them look premium for a new launch",
              scopePolished:
                "Brand film for Heineken — making them look premium for a new launch"
            },
            briefReady: false,
            reviewPrompt: null,
            missingFields: ['projectType', 'service', 'timelineBand', 'budgetBand', 'contact']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/sessions')) {
        return new Response(
          JSON.stringify({ sessionId: 'mock-session', persisted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    fireEvent.change(input, {
      target: {
        value: "It's a brand film for Heineken — making them look premium for a new launch"
      }
    });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The rail mounts because hasProjectIntent is now true (projectScope is set).
    await waitFor(
      () => {
        expect(screen.queryByTestId('review-rail')).not.toBeNull();
      },
      { timeout: 4000 }
    );

    // The brief card inside the rail renders the scope row with the user's text.
    await waitFor(
      () => {
        const rail = screen.getByTestId('review-rail');
        const briefCard = rail.querySelector('[data-testid="project-brief-card"]') as HTMLElement | null;
        expect(briefCard).not.toBeNull();
        const scopeRow = briefCard!.querySelector(
          '[data-row-key="projectScope"]'
        ) as HTMLElement | null;
        expect(scopeRow).not.toBeNull();
        expect(scopeRow!.getAttribute('data-filled')).toBe('true');
        expect(scopeRow!.textContent).toContain('Heineken');
      },
      { timeout: 4000 }
    );
  });
});

describe('intake short replies stay on the LLM path', () => {
  test('sending "ok" during the service step calls /api/chat again and skips the scripted summary', async () => {
    const chatCalls: Array<{ step: string }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        chatCalls.push({ step: body.context.step });

        if (chatCalls.length === 1) {
          return new Response(
            JSON.stringify({
              message: 'Got it. What kind of support do you need from Balance Studio?',
              draftUpdates: {
                projectScope: '30s animation for social media',
                scopePolished: '30s animation for social media'
              },
              briefReady: false,
              reviewPrompt: null,
              missingFields: ['service', 'timelineBand', 'budgetBand', 'contact']
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            message: 'No problem. Tell me the kind of support you are exploring and I will shape it with you.',
            draftUpdates: {},
            briefReady: false,
            reviewPrompt: null,
            missingFields: ['service', 'timelineBand', 'budgetBand', 'contact']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/sessions')) {
        return new Response(
          JSON.stringify({ sessionId: 'mock-session', persisted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/events')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    await waitFor(() => {
      expect(screen.getAllByText(/What can I help you with today\?/i).length).toBeGreaterThan(0);
    }, { timeout: 7000 });

    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/What kind of support do you need/i)).toBeInTheDocument();
    }, { timeout: 4000 });

    fireEvent.change(input, { target: { value: 'ok' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(chatCalls).toHaveLength(2);
    }, { timeout: 4000 });

    await waitFor(() => {
      expect(
        screen.getByText(/No problem\. Tell me the kind of support you are exploring/i)
      ).toBeInTheDocument();
    }, { timeout: 4000 });

    expect(screen.queryByText(/So far I have:/i)).toBeNull();
  }, 10000);

  test('sending "who are you" during the service step uses the FAQ or LLM path instead of the local canned intro', async () => {
    const chatCalls: Array<{ step: string }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        chatCalls.push({ step: body.context.step });

        if (chatCalls.length === 1) {
          return new Response(
            JSON.stringify({
              message: 'Got it. What kind of support do you need from Balance Studio?',
              draftUpdates: {
                projectScope: '30s animation for social media',
                scopePolished: '30s animation for social media'
              },
              briefReady: false,
              reviewPrompt: null,
              missingFields: ['service', 'timelineBand', 'budgetBand', 'contact']
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            messages: [
              'Balance Studio is a Singapore-based, full-service video and creative production house with 10+ years of experience, 100+ clients, and 110+ projects delivered worldwide.',
              'We handle the whole pipeline in-house - concept, production, post-production, motion graphics, VFX, design, and generative-AI workflows, with work for clients like Rolls-Royce, Canon, Netflix, Chanel, HSBC, and Nestle.'
            ],
            draftUpdates: {},
            briefReady: false,
            reviewPrompt: null,
            missingFields: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/sessions')) {
        return new Response(
          JSON.stringify({ sessionId: 'mock-session', persisted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/events')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    const input = await startAiConversation();

    await waitFor(() => {
      expect(screen.getAllByText(/What can I help you with today\?/i).length).toBeGreaterThan(0);
    }, { timeout: 7000 });

    fireEvent.change(input, { target: { value: '30s animation for social media' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/What kind of support do you need/i)).toBeInTheDocument();
    }, { timeout: 4000 });

    fireEvent.change(input, { target: { value: 'who are you' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(chatCalls).toHaveLength(2);
    }, { timeout: 4000 });

    await waitFor(() => {
      expect(
        screen.getByText(/Balance Studio is a Singapore-based, full-service video and creative production house/i)
      ).toBeInTheDocument();
    }, { timeout: 4000 });

    expect(
      screen.queryByText(/I'm \*\*Balance Assist\*\* - Balance Studio's intelligent AI agent/i)
    ).toBeNull();
  }, 10000);
});
