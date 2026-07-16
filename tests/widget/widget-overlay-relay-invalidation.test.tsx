// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { sendMock, pollMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => 'invalidated' as const),
  pollMock: vi.fn(async () => undefined)
}));

vi.mock('@/components/widget/use-team-relay', async () => {
  const React = await import('react');
  return {
    useTeamRelay: () => {
      const [requested, setRequested] = React.useState(false);
      return {
        requested,
        status: requested ? 'requested' as const : 'idle' as const,
        isTeamConnected: false,
        waitingForReply: false,
        fileRequestOpen: false,
        fileRequestNote: null,
        scheduleRequestOpen: false,
        messages: [],
        requestHandoff: () => { setRequested(true); return true; },
        send: sendMock,
        poll: pollMock,
        reset: vi.fn(),
        stop: vi.fn(),
        resume: vi.fn(),
        clearRequests: vi.fn(),
        markUploadPending: vi.fn(),
        markUploadFailed: vi.fn(),
        markRequested: vi.fn()
      };
    }
  };
});

import { WidgetOverlay } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;

beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
});

afterEach(() => {
  global.fetch = originalFetch;
  sendMock.mockClear();
  pollMock.mockClear();
});

describe('WidgetOverlay relay invalidation', () => {
  test('does not continue polling or report failure after an invalidated send', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sessions/inspect')) {
        return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      }
      if (url.includes('/api/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'session-1', persisted: true }), { status: 200 });
      }
      if (url.includes('/consent')) {
        return new Response(JSON.stringify({ ok: true, consent: { humanContact: true } }), { status: 200 });
      }
      if (url.includes('/api/events')) {
        return new Response(JSON.stringify({ ok: true, eventName: 'human_handoff' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Talk to the team without AI' }));
    const input = await screen.findByPlaceholderText(/message the team request/i);
    fireEvent.change(input, { target: { value: 'Please call me' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(sendMock).toHaveBeenCalledWith('Please call me'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pollMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/could not reach the team/i)).toBeNull();
  });
});
