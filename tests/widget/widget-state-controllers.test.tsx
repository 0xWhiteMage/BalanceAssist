// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useWidgetSessionDraft } from '@/components/widget/use-widget-session-draft';
import { useTeamRelay } from '@/components/widget/use-team-relay';
import { fetchTeamMessages, relayUserMessage } from '@/lib/api/client';
import type { ConsentRecord } from '@/lib/privacy/notice';

const consent: ConsentRecord = {
  consentVersion: '1.1',
  consentedAt: '2026-07-14T10:00:00.000Z'
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useWidgetSessionDraft', () => {
  test('replaces the local draft and version with the canonical chat result', async () => {
    const updateDraft = vi.fn(async () => ({
      ok: true as const,
      draftVersion: 7,
      fieldCount: 1,
      draft: { projectScope: 'Canonical launch film' }
    }));
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true })),
      getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: updateDraft,
      resetProject: vi.fn(async () => true),
      requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));

    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });
    await act(async () => {
      await result.current.applyChatDraft({ projectScope: 'Local launch film' });
    });

    expect(updateDraft).toHaveBeenCalledWith('session-1', [{
      field: 'projectScope', value: 'Local launch film', provenance: 'inferred'
    }], 0);
    expect(result.current.draft.projectScope).toBe('Canonical launch film');
    expect(result.current.draftVersion).toBe(7);
  });

  test('clears the approval lock after a failed approval so it can retry', async () => {
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true })),
      getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: vi.fn(),
      resetProject: vi.fn(async () => true),
      requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));

    const failed = vi.fn(async () => false);
    const succeeded = vi.fn(async () => true);

    await act(async () => {
      expect(await result.current.approve(failed)).toBe(false);
      expect(await result.current.approve(succeeded)).toBe(true);
    });

    expect(failed).toHaveBeenCalledTimes(1);
    expect(succeeded).toHaveBeenCalledTimes(1);
    expect(result.current.briefApproved).toBe(true);
  });

  test('exposes an expired temporary capability status', async () => {
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true, expiresAt: '2026-07-13T10:00:00.000Z' })),
      getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: vi.fn(),
      resetProject: vi.fn(async () => true),
      requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));

    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });

    expect(result.current.isSessionExpired).toBe(true);
  });

  test('does not reuse an expired session and creates a fresh one', async () => {
    const createSession = vi.fn(async () => ({ sessionId: 'fresh-session', status: 'new', sourceUrl: '', persisted: true }));
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession,
      getCurrentSession: vi.fn(async () => ({ sessionId: 'expired-session', status: 'open', sourceUrl: '', expiresAt: '2026-07-13T10:00:00.000Z' })),
      fetchProjectDraft: vi.fn(async () => null), updateProjectDraft: vi.fn(), resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));

    await act(async () => { await result.current.loadOrCreateSession(); });

    expect(createSession).toHaveBeenCalledOnce();
    expect(result.current.sessionId).toBe('fresh-session');
    expect(result.current.expiresAt).toBeNull();
    expect(result.current.isSessionExpired).toBe(false);
  });
});

describe('useTeamRelay', () => {
  test('ignores previous-outbox delivery evidence while the current send is pending', async () => {
    const pendingSend = deferred<{ persisted: boolean; queued: boolean; delivered: boolean }>();
    const poll = vi.fn(async () => ({ outgoingStatus: 'delivered' as const, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1',
      fetchTeamMessages: poll,
      relayUserMessage: vi.fn(() => pendingSend.promise)
    }));
    act(() => result.current.requestHandoff());

    let sendPromise!: Promise<'persisted' | 'failed' | 'invalidated'>;
    act(() => { sendPromise = result.current.send('Hello'); });
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('sending');

    await act(async () => {
      pendingSend.resolve({ persisted: true, queued: true, delivered: false });
      await sendPromise;
    });
    expect(result.current.status).toBe('queued');
  });

  test('keeps delivery suppressed when a pending-send poll resolves after acknowledgement', async () => {
    const pendingSend = deferred<{ persisted: boolean; queued: boolean; delivered: boolean }>();
    const pendingPoll = deferred<{
      outgoingStatus: 'delivered';
      messages: [];
      fileRequestOpen: false;
      fileRequestNote: null;
      scheduleRequestOpen: false;
    }>();
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1',
      fetchTeamMessages: vi.fn(() => pendingPoll.promise),
      relayUserMessage: vi.fn(() => pendingSend.promise)
    }));

    let sendPromise!: Promise<'persisted' | 'failed' | 'invalidated'>;
    act(() => { sendPromise = result.current.send('Hello'); });
    let pollPromise!: Promise<void>;
    act(() => { pollPromise = result.current.poll(); });
    await act(async () => {
      pendingSend.resolve({ persisted: true, queued: true, delivered: false });
      await sendPromise;
    });
    expect(result.current.status).toBe('queued');

    await act(async () => {
      pendingPoll.resolve({ outgoingStatus: 'delivered', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
      await pollPromise;
    });
    expect(result.current.status).toBe('queued');
  });

  test('accepts a team reply while the current send is pending', async () => {
    const pendingSend = deferred<{ persisted: boolean; queued: boolean; delivered: boolean }>();
    const poll = vi.fn(async () => ({
      outgoingStatus: 'delivered' as const,
      messages: [{ id: 1, sender: 'team' as const, text: 'Reply', createdAt: '2026-07-17T10:00:00.000Z' }],
      fileRequestOpen: false,
      fileRequestNote: null,
      scheduleRequestOpen: false
    }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: vi.fn(() => pendingSend.promise)
    }));

    let sendPromise!: Promise<'persisted' | 'failed' | 'invalidated'>;
    act(() => { sendPromise = result.current.send('Hello'); });
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('replied');

    await act(async () => {
      pendingSend.resolve({ persisted: true, queued: true, delivered: false });
      await sendPromise;
    });
    expect(result.current.status).toBe('replied');
  });

  test('does not let an older poll promote or leak into a newer send', async () => {
    const pendingPoll = deferred<{
      outgoingStatus: 'delivered';
      messages: Array<{ id: number; sender: 'team'; text: string; createdAt: string }>;
      fileRequestOpen: boolean;
      fileRequestNote: string;
      scheduleRequestOpen: boolean;
    }>();
    const pendingSend = deferred<{ persisted: boolean; queued: boolean; delivered: boolean }>();
    const poll = vi.fn(() => pendingPoll.promise);
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1',
      fetchTeamMessages: poll,
      relayUserMessage: vi.fn(() => pendingSend.promise)
    }));

    let pollPromise!: Promise<void>;
    act(() => { pollPromise = result.current.poll(); });
    let sendPromise!: Promise<'persisted' | 'failed' | 'invalidated'>;
    act(() => { sendPromise = result.current.send('New message'); });
    await act(async () => {
      pendingPoll.resolve({
        outgoingStatus: 'delivered',
        messages: [{ id: 41, sender: 'team', text: 'Old reply', createdAt: '2026-07-17T10:00:00.000Z' }],
        fileRequestOpen: true,
        fileRequestNote: 'Old request',
        scheduleRequestOpen: true
      });
      await pollPromise;
    });

    expect(result.current.status).toBe('sending');
    expect(result.current.messages).toEqual([]);
    expect(result.current.fileRequestOpen).toBe(false);
    expect(result.current.scheduleRequestOpen).toBe(false);

    await act(async () => {
      pendingSend.resolve({ persisted: true, queued: true, delivered: false });
      await sendPromise;
    });
    expect(result.current.status).toBe('queued');
  });

  test('does not let callbacks retained before reset adopt the reset generation', async () => {
    const relay = vi.fn(async () => ({ persisted: true, queued: true, delivered: false }));
    const poll = vi.fn(async () => ({ outgoingStatus: 'delivered' as const, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: relay
    }));
    const retainedSend = result.current.send;
    const retainedPoll = result.current.poll;

    act(() => result.current.reset());
    await expect(retainedSend('Old message')).resolves.toBe('invalidated');
    await retainedPoll();

    expect(relay).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  test('does not let callbacks retained from an old session adopt the new session generation', async () => {
    const relay = vi.fn(async () => ({ persisted: true, queued: true, delivered: false }));
    const poll = vi.fn(async () => ({ outgoingStatus: 'delivered' as const, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useTeamRelay({ sessionId, fetchTeamMessages: poll, relayUserMessage: relay }),
      { initialProps: { sessionId: 'session-1' } }
    );
    const retainedSend = result.current.send;
    const retainedPoll = result.current.poll;

    rerender({ sessionId: 'session-2' });
    await expect(retainedSend('Old message')).resolves.toBe('invalidated');
    await retainedPoll();

    expect(relay).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  test('provides working current callbacks immediately after an idle reset', async () => {
    const relay = vi.fn(async () => ({ persisted: true, queued: true, delivered: false }));
    const poll = vi.fn(async () => ({ outgoingStatus: 'delivered' as const, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: relay
    }));
    const retainedSend = result.current.send;
    const retainedPoll = result.current.poll;

    act(() => result.current.reset());
    await expect(retainedSend('Old message')).resolves.toBe('invalidated');
    await retainedPoll();
    let outcome: unknown;
    await act(async () => { outcome = await result.current.send('Current message'); });
    await act(async () => { await result.current.poll(); });

    expect(outcome).toBe('persisted');
    expect(relay).toHaveBeenCalledWith('session-1', 'Current message', expect.any(String));
    expect(poll).toHaveBeenCalledWith('session-1', 0);
    expect(result.current.status).toBe('delivered');
  });

  test('provides working current callbacks immediately after an idle session change', async () => {
    const relay = vi.fn(async () => ({ persisted: true, queued: true, delivered: false }));
    const poll = vi.fn(async () => ({ outgoingStatus: 'delivered' as const, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useTeamRelay({ sessionId, fetchTeamMessages: poll, relayUserMessage: relay }),
      { initialProps: { sessionId: 'session-1' } }
    );
    const retainedSend = result.current.send;
    const retainedPoll = result.current.poll;

    rerender({ sessionId: 'session-2' });
    await expect(retainedSend('Old message')).resolves.toBe('invalidated');
    await retainedPoll();
    let outcome: unknown;
    await act(async () => { outcome = await result.current.send('Current message'); });
    await act(async () => { await result.current.poll(); });

    expect(outcome).toBe('persisted');
    expect(relay).toHaveBeenCalledWith('session-2', 'Current message', expect.any(String));
    expect(poll).toHaveBeenCalledWith('session-2', 0);
    expect(result.current.status).toBe('delivered');
  });

  test('reset invalidates pending send and poll without leaking state or sinceId', async () => {
    const pendingPoll = deferred<{
      outgoingStatus: 'delivered';
      messages: Array<{ id: number; sender: 'team'; text: string; createdAt: string }>;
      fileRequestOpen: boolean;
      fileRequestNote: string;
      scheduleRequestOpen: boolean;
    }>();
    const pendingSend = deferred<{ persisted: boolean; queued: boolean; delivered: boolean }>();
    const nextPoll = vi.fn(async () => ({ outgoingStatus: null, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const poll = vi.fn()
      .mockImplementationOnce(() => pendingPoll.promise)
      .mockImplementation(nextPoll);
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: vi.fn(() => pendingSend.promise)
    }));
    act(() => result.current.requestHandoff());
    let pollPromise!: Promise<void>;
    act(() => { pollPromise = result.current.poll(); });
    let sendPromise!: Promise<'persisted' | 'failed' | 'invalidated'>;
    act(() => { sendPromise = result.current.send('Hello'); });
    act(() => result.current.reset());

    let sendOutcome: unknown;
    await act(async () => {
      pendingPoll.resolve({
        outgoingStatus: 'delivered',
        messages: [{ id: 51, sender: 'team', text: 'Old reply', createdAt: '2026-07-17T10:00:00.000Z' }],
        fileRequestOpen: true,
        fileRequestNote: 'Old request',
        scheduleRequestOpen: true
      });
      pendingSend.resolve({ persisted: true, queued: true, delivered: false });
      [, sendOutcome] = await Promise.all([pollPromise, sendPromise]);
    });

    expect(sendOutcome).toBe('invalidated');
    expect(result.current.status).toBe('idle');
    expect(result.current.requested).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(result.current.fileRequestOpen).toBe(false);
    expect(result.current.fileRequestNote).toBeNull();
    expect(result.current.scheduleRequestOpen).toBe(false);
    await act(async () => { await result.current.poll(); });
    expect(poll).toHaveBeenLastCalledWith('session-1', 0);
  });

  test('session change invalidates old work and allows the new session to poll cleanly', async () => {
    const pendingPoll = deferred<{
      outgoingStatus: 'delivered';
      messages: Array<{ id: number; sender: 'team'; text: string; createdAt: string }>;
      fileRequestOpen: boolean;
      fileRequestNote: string;
      scheduleRequestOpen: boolean;
    }>();
    const pendingSend = deferred<{ persisted: boolean; queued: boolean; delivered: boolean }>();
    const poll = vi.fn()
      .mockImplementationOnce(() => pendingPoll.promise)
      .mockResolvedValue({ outgoingStatus: 'queued', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
    const relay = vi.fn(() => pendingSend.promise);
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useTeamRelay({ sessionId, fetchTeamMessages: poll, relayUserMessage: relay }),
      { initialProps: { sessionId: 'session-1' } }
    );
    act(() => result.current.requestHandoff());
    let pollPromise!: Promise<void>;
    act(() => { pollPromise = result.current.poll(); });
    let sendPromise!: Promise<'persisted' | 'failed' | 'invalidated'>;
    act(() => { sendPromise = result.current.send('Old message'); });
    rerender({ sessionId: 'session-2' });

    await act(async () => {
      pendingPoll.resolve({
        outgoingStatus: 'delivered',
        messages: [{ id: 61, sender: 'team', text: 'Old reply', createdAt: '2026-07-17T10:00:00.000Z' }],
        fileRequestOpen: true,
        fileRequestNote: 'Old request',
        scheduleRequestOpen: true
      });
      pendingSend.resolve({ persisted: true, queued: true, delivered: false });
      await Promise.all([pollPromise, sendPromise]);
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.requested).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(result.current.fileRequestOpen).toBe(false);
    expect(result.current.fileRequestNote).toBeNull();
    expect(result.current.scheduleRequestOpen).toBe(false);
    await act(async () => { await result.current.poll(); });
    expect(poll).toHaveBeenLastCalledWith('session-2', 0);
    expect(result.current.status).toBe('queued');
  });

  test('promotes queued to delivered only from polling and then to replied', async () => {
    const relay = vi.fn(async () => ({ persisted: true, queued: true, delivered: false }));
    const poll = vi.fn()
      .mockResolvedValueOnce({ outgoingStatus: 'queued', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })
      .mockResolvedValueOnce({ outgoingStatus: 'delivered', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })
      .mockResolvedValueOnce({ outgoingStatus: 'delivered', messages: [{ id: 1, sender: 'team' as const, text: 'Reply', createdAt: '2026-07-16T10:00:00.000Z' }], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: relay
    }));
    act(() => result.current.requestHandoff());

    await act(async () => { await result.current.send('Hello'); });
    expect(result.current.status).toBe('queued');
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('queued');
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('delivered');
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('replied');
  });

  test('preserves queued after a rejected poll and retries on the next timer tick', async () => {
    vi.useFakeTimers();
    const poll = vi.fn()
      .mockRejectedValueOnce(new Error('relay_status_unavailable'))
      .mockResolvedValueOnce({ outgoingStatus: 'queued', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
    const { result, unmount } = renderHook(() => useTeamRelay({
      sessionId: 'session-1',
      fetchTeamMessages: poll,
      relayUserMessage: vi.fn(async () => ({ persisted: true, queued: true, delivered: false }))
    }));
    act(() => result.current.requestHandoff());
    await act(async () => { await result.current.send('Hello'); });

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.status).toBe('queued');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('queued');
    unmount();
    vi.useRealTimers();
  });

  test('does not demote delivered when a later poll is queued', async () => {
    const poll = vi.fn()
      .mockResolvedValueOnce({ outgoingStatus: 'delivered', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })
      .mockResolvedValueOnce({ outgoingStatus: 'queued', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: vi.fn()
    }));

    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('delivered');
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('delivered');
  });

  test('does not fabricate delivery from an inconclusive successful poll', async () => {
    const poll = vi.fn(async () => ({ outgoingStatus: null, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1',
      fetchTeamMessages: poll,
      relayUserMessage: vi.fn(async () => ({ persisted: true, queued: true, delivered: false }))
    }));
    act(() => result.current.requestHandoff());
    await act(async () => { await result.current.send('Hello'); });
    await act(async () => { await result.current.poll(); });

    expect(result.current.status).toBe('queued');
  });

  test('keeps replied after later outgoing delivery evidence', async () => {
    const poll = vi.fn()
      .mockResolvedValueOnce({ outgoingStatus: 'queued', messages: [{ id: 1, sender: 'team' as const, text: 'Reply', createdAt: '2026-07-16T10:00:00.000Z' }], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })
      .mockResolvedValueOnce({ outgoingStatus: 'delivered', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: vi.fn()
    }));

    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('replied');
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('replied');
  });

  test('returns a rejected relay send to the requested retryable state', async () => {
    const relay = vi.fn<(sessionId: string, text: string, requestId: string) => Promise<boolean>>(async () => false);
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: vi.fn(), relayUserMessage: relay
    }));
    act(() => result.current.requestHandoff());
    await act(async () => { await result.current.send('Hello'); });
    await act(async () => { await result.current.send('Hello'); });

    expect(result.current.status).toBe('requested');
    expect(result.current.waitingForReply).toBe(false);
    expect(relay.mock.calls[0]?.[2]).toEqual(expect.any(String));
    expect(relay.mock.calls[1]?.[2]).toBe(relay.mock.calls[0]?.[2]);
  });

  test('stops controller polling when closed', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => ({ outgoingStatus: null, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result } = renderHook(() => useTeamRelay({ sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: vi.fn() }));
    act(() => result.current.requestHandoff());
    act(() => result.current.stop());
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(poll).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('preserves an active relay when temporarily stopped and resumes polling when reopened', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => ({ outgoingStatus: null, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result } = renderHook(() => useTeamRelay({ sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: vi.fn() }));
    act(() => result.current.requestHandoff());
    act(() => result.current.stop());
    expect(result.current.requested).toBe(true);
    act(() => result.current.resume());
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(poll).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  test('continues polling after an empty response and marks connected only after a team reply', async () => {
    vi.useFakeTimers();
    const poll = vi.fn()
      .mockResolvedValueOnce({ outgoingStatus: null, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })
      .mockResolvedValueOnce({ outgoingStatus: null, messages: [{ id: 3, sender: 'team' as const, text: 'We can help', createdAt: '2026-07-14T10:00:00.000Z' }], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
    const { result, unmount } = renderHook(() => useTeamRelay({
      sessionId: 'session-1',
      fetchTeamMessages: poll,
      relayUserMessage: vi.fn(async () => true)
    }));

    act(() => result.current.requestHandoff());
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current.isTeamConnected).toBe(true);
    expect(result.current.status).toBe('replied');
    unmount();
    vi.useRealTimers();
  });
});

describe('relay API client', () => {
  const originalFetch = global.fetch;
  const validPollResponse = {
    outgoingStatus: 'queued',
    messages: [{ id: 1, sender: 'team', text: 'Reply', createdAt: '2026-07-17T10:00:00.000Z' }],
    fileRequestOpen: false,
    fileRequestNote: null,
    scheduleRequestOpen: false
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('never reports delivered from the relay POST response', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      persisted: true,
      queued: true,
      telegramSent: true
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(relayUserMessage('session-1', 'Hello', 'request-1')).resolves.toEqual({
      persisted: true,
      queued: true,
      delivered: false
    });
  });

  test('returns only a valid outgoing poll status', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      outgoingStatus: 'queued',
      messages: [],
      fileRequestOpen: false,
      fileRequestNote: null,
      scheduleRequestOpen: false
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(fetchTeamMessages('session-1')).resolves.toEqual({
      outgoingStatus: 'queued',
      messages: [],
      fileRequestOpen: false,
      fileRequestNote: null,
      scheduleRequestOpen: false
    });
  });

  test.each([
    ['an HTTP failure', async () => new Response('{}', { status: 503 })],
    ['a network failure', async () => { throw new TypeError('offline'); }],
    ['an invalid status', async () => new Response(JSON.stringify({ ...validPollResponse, outgoingStatus: 'sent' }), { status: 200 })]
  ])('throws the stable unavailable error for %s', async (_case, fetchResult) => {
    global.fetch = vi.fn(fetchResult);

    await expect(fetchTeamMessages('session-1')).rejects.toThrowError('relay_status_unavailable');
  });

  test.each([
    ['a non-array messages value', { ...validPollResponse, messages: null }],
    ['a non-number message id', { ...validPollResponse, messages: [{ ...validPollResponse.messages[0], id: '1' }] }],
    ['an unknown message sender', { ...validPollResponse, messages: [{ ...validPollResponse.messages[0], sender: 'provider' }] }],
    ['a non-string message text', { ...validPollResponse, messages: [{ ...validPollResponse.messages[0], text: 7 }] }],
    ['a non-string message createdAt', { ...validPollResponse, messages: [{ ...validPollResponse.messages[0], createdAt: null }] }],
    ['a non-boolean fileRequestOpen', { ...validPollResponse, fileRequestOpen: 1 }],
    ['a non-string fileRequestNote', { ...validPollResponse, fileRequestNote: 7 }],
    ['a non-boolean scheduleRequestOpen', { ...validPollResponse, scheduleRequestOpen: 'false' }]
  ])('rejects malformed successful polling with %s', async (_case, body) => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(fetchTeamMessages('session-1')).rejects.toThrowError('relay_status_unavailable');
  });

  test('does not let a malformed successful poll poison the next sinceId', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...validPollResponse,
        messages: [{ ...validPollResponse.messages[0], id: 'bad-id' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...validPollResponse,
        messages: [{ ...validPollResponse.messages[0], id: 7 }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1',
      fetchTeamMessages,
      relayUserMessage: vi.fn()
    }));

    await act(async () => { await result.current.poll().catch(() => undefined); });
    await act(async () => { await result.current.poll(); });

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/telegram/messages?sessionId=session-1&sinceId=0', expect.any(Object));
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/telegram/messages?sessionId=session-1&sinceId=0', expect.any(Object));
    expect(result.current.messages.map((message) => message.id)).toEqual([7]);
  });

  test.each([
    ['fractional', 1.5],
    ['negative', -1],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1]
  ])('rejects a %s message id without poisoning sinceId', async (_case, invalidId) => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...validPollResponse,
        messages: [{ ...validPollResponse.messages[0], id: invalidId }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...validPollResponse,
        messages: [{ ...validPollResponse.messages[0], id: 7 }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages, relayUserMessage: vi.fn()
    }));

    await act(async () => { await result.current.poll().catch(() => undefined); });
    await act(async () => { await result.current.poll(); });

    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/telegram/messages?sessionId=session-1&sinceId=0', expect.any(Object));
    expect(result.current.messages.map((message) => message.id)).toEqual([7]);
  });
});
