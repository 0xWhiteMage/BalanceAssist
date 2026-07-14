// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useWidgetSessionDraft } from '@/components/widget/use-widget-session-draft';
import { useTeamRelay } from '@/components/widget/use-team-relay';
import type { ConsentRecord } from '@/lib/privacy/notice';

const consent: ConsentRecord = {
  consentVersion: '1.0',
  consentedAt: '2026-07-14T10:00:00.000Z'
};

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
});

describe('useTeamRelay', () => {
  test('continues polling after an empty response and marks connected only after a team reply', async () => {
    vi.useFakeTimers();
    const poll = vi.fn()
      .mockResolvedValueOnce({ messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })
      .mockResolvedValueOnce({ messages: [{ id: 3, sender: 'team' as const, text: 'We can help', createdAt: '2026-07-14T10:00:00.000Z' }], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
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
