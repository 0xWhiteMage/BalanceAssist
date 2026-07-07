// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WidgetOverlay } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;

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

describe('WidgetOverlay brief rail gating (Fix 4)', () => {
  test('typing an out-of-scope "draft text for my homework" message does NOT open the brief rail', async () => {
    global.fetch = chatSessionResponse();

    render(<WidgetOverlay autoOpen={true} />);

    const input = (await waitFor(() => {
      const el = screen.getByPlaceholderText(/Type your message|Message the team/i) as HTMLInputElement;
      expect(el).toBeInTheDocument();
      return el;
    })) as HTMLInputElement;

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

    const input = (await waitFor(() => {
      const el = screen.getByPlaceholderText(/Type your message|Message the team/i) as HTMLInputElement;
      expect(el).toBeInTheDocument();
      return el;
    }, { timeout: 4000 })) as HTMLInputElement;

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

    const input = (await waitFor(() => {
      const el = screen.getByPlaceholderText(/Type your message|Message the team/i) as HTMLInputElement;
      expect(el).toBeInTheDocument();
      return el;
    }, { timeout: 4000 })) as HTMLInputElement;

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
