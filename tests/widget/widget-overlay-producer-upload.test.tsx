// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WidgetOverlay } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;

const relayActions = vi.hoisted(() => ({
  requestHandoff: vi.fn(() => true),
  markUploadPending: vi.fn(),
  markUploadFailed: vi.fn()
}));

vi.mock('@/components/widget/use-team-relay', () => ({
  useTeamRelay: () => ({
    requested: true,
    status: 'requested',
    isTeamConnected: true,
    waitingForReply: false,
    fileRequestOpen: true,
    fileRequestNote: 'Please upload the treatment.',
    scheduleRequestOpen: false,
    messages: [],
    requestHandoff: relayActions.requestHandoff,
    send: vi.fn(),
    poll: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    clearRequests: vi.fn(),
    markUploadPending: relayActions.markUploadPending,
    markUploadFailed: relayActions.markUploadFailed,
    markRequested: vi.fn()
  })
}));

vi.mock('@/components/widget/use-widget-session-draft', () => ({
  useWidgetSessionDraft: () => ({
    draft: {}, setDraft: vi.fn(), noticeConsent: null, setNoticeConsent: vi.fn(),
    hasProjectIntent: false, setHasProjectIntent: vi.fn(), briefApproved: false,
    sessionId: 'human-upload-session', sessionUnavailable: false, isSessionExpired: false,
    draftVersion: 0, setDraftVersion: vi.fn(), approval: {}, applyCanonicalDraft: vi.fn(), hydrateDraft: vi.fn(),
    ensureSession: vi.fn(async () => 'human-upload-session'), loadOrCreateSession: vi.fn(async () => 'human-upload-session'),
    invalidateBootstrap: vi.fn(), reset: vi.fn(), beginApproval: vi.fn(() => false), finishApproval: vi.fn(), recordApproval: vi.fn()
  })
}));

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  relayActions.requestHandoff.mockClear();
  relayActions.markUploadPending.mockClear();
  relayActions.markUploadFailed.mockClear();
});

describe('producer-requested human uploads', () => {
  test('keeps the requested-file input available when the team connection starts from AI mode', async () => {
    render(<WidgetOverlay autoOpen={true} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Build a brief with AI' }));

    const uploadButton = await screen.findByRole('button', { name: 'Upload files' });
    const fileInput = screen.getByLabelText('Choose requested files');
    const inputClick = vi.spyOn(fileInput, 'click');

    fireEvent.click(uploadButton);

    expect(inputClick).toHaveBeenCalledOnce();
  });

  test('shows a keyboard-reachable human-only control and uploads with explicit producer consent', async () => {
    const requests: Array<{ url: string; body: BodyInit | null | undefined; headers?: HeadersInit }> = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body, headers: init?.headers });
      if (url.includes('/api/sessions/inspect')) {
        return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      }
      if (url.endsWith('/api/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'human-upload-session', persisted: true }), { status: 200 });
      }
      if (url.includes('/consent')) {
        const scope = JSON.parse(String(init?.body)).scope;
        return new Response(JSON.stringify({
          ok: true,
          consent: scope === 'producer_transfer' ? { producerTransfer: true } : { humanContact: true }
        }), { status: 200 });
      }
      if (url.includes('/api/telegram/upload')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    render(<WidgetOverlay autoOpen={true} />);

    expect(screen.queryByRole('button', { name: 'Upload requested files' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to the team without AI' }));

    const uploadButton = await screen.findByRole('button', { name: 'Upload files' });
    expect(uploadButton).toBeVisible();
    expect(uploadButton).toHaveClass('balance-widget-action', 'balance-request-primary');
    uploadButton.focus();
    expect(uploadButton).toHaveFocus();

    const fileInput = screen.getByLabelText('Choose requested files');
    fireEvent.change(fileInput, {
      target: { files: [new File(['ordinary treatment'], 'treatment.txt', { type: 'text/plain' })] }
    });

    await waitFor(() => expect(requests.some(({ url }) => url.includes('/api/telegram/upload'))).toBe(true));
    const consentRequest = requests.find(({ url, body }) => url.includes('/consent') && String(body).includes('producer_transfer'));
    expect(JSON.parse(String(consentRequest?.body))).toMatchObject({ scope: 'producer_transfer', granted: true });
    const uploadRequest = requests.find(({ url }) => url.includes('/api/telegram/upload'));
    expect(uploadRequest?.headers).toMatchObject({ 'x-upload-mode': 'human' });
    expect(uploadRequest?.body).toBeInstanceOf(FormData);
    expect((uploadRequest?.body as FormData).get('mode')).toBe('human');
  });

  test('keeps upload failures visible in the human conversation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requests: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body });
      if (url.includes('/api/sessions/inspect')) return new Response(JSON.stringify({ ok: true, exists: false }), { status: 200 });
      if (url.endsWith('/api/sessions') && init?.method === 'POST') return new Response(JSON.stringify({ sessionId: 'human-upload-session', persisted: true }), { status: 200 });
      if (url.includes('/consent')) {
        const scope = JSON.parse(String(init?.body)).scope;
        return new Response(JSON.stringify({ ok: true, consent: scope === 'producer_transfer' ? { producerTransfer: true } : { humanContact: true } }), { status: 200 });
      }
      if (url.includes('/api/telegram/upload')) return new Response(JSON.stringify({ error: 'Requested file upload failed.' }), { status: 503 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    render(<WidgetOverlay autoOpen={true} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to the team without AI' }));

    fireEvent.change(await screen.findByLabelText('Choose requested files'), {
      target: { files: [new File(['ordinary treatment'], 'treatment.txt', { type: 'text/plain' })] }
    });

    expect(await screen.findByText('Requested file upload failed.')).toBeVisible();
    expect(relayActions.markUploadFailed).toHaveBeenCalled();
  });

  test('retains owned preview URLs across close and reopen, then revokes them on unmount', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const createObjectUrl = vi.fn(() => 'blob:owned-preview');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/consent')) return new Response(JSON.stringify({ ok: true, consent: { producerTransfer: true } }), { status: 200 });
      if (url.includes('/api/telegram/upload')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const view = render(<WidgetOverlay autoOpen={true} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to the team without AI' }));
    fireEvent.change(await screen.findByLabelText('Choose requested files'), {
      target: { files: [new File(['image'], 'frame.png', { type: 'image/png' })] }
    });
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByLabelText('Close Balance Assist'));
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Open Balance Assist'));
    expect(await screen.findByText('Upload quarantined: frame.png')).toBeVisible();
    expect(createObjectUrl).toHaveBeenCalledOnce();

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:owned-preview');
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });
});
