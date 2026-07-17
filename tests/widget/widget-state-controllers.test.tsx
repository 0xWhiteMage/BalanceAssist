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

  test('applies a winning conflict and leaves canonical state unchanged on failure', async () => {
    const updateDraft = vi.fn()
      .mockResolvedValueOnce({ ok: false, conflict: true, draftVersion: 9, fieldCount: 1, draft: { projectScope: 'Winning draft' } })
      .mockResolvedValueOnce({ ok: false, conflict: false });
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true })),
      getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null), updateProjectDraft: updateDraft,
      resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });

    let conflictResult;
    await act(async () => { conflictResult = await result.current.updateDraft('projectScope', 'Losing change'); });
    expect(conflictResult).toMatchObject({ ok: false, conflict: true });
    expect(result.current.draft.projectScope).toBe('Winning draft');
    expect(result.current.draftVersion).toBe(9);

    await act(async () => { await result.current.updateDraft('projectScope', 'Unsaved change'); });
    expect(result.current.draft.projectScope).toBe('Winning draft');
    expect(result.current.draftVersion).toBe(9);
  });

  test('preserves approval for an identical same-version chat canonical response', () => {
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => null), getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: vi.fn(), resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    const canonical = { projectScope: 'Approved launch film' };

    act(() => result.current.applyCanonicalDraft(canonical, 4, {
      draft: canonical,
      draftVersion: 4,
      fieldCount: 1,
      approvedDraftVersion: 4,
      canonicalReferenceSetHash: 'same-hash',
      approvedReferenceSetHash: 'same-hash'
    }));
    expect(result.current.briefApproved).toBe(true);

    act(() => result.current.applyCanonicalDraft(canonical, 4));

    expect(result.current.briefApproved).toBe(true);
    expect(result.current.draftVersion).toBe(4);
  });

  test('does not destructively replace canonical state at the same draft version', () => {
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => null), getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: vi.fn(), resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));

    act(() => result.current.applyCanonicalDraft({ projectScope: 'First version four value' }, 4));
    let applied = true;
    act(() => {
      applied = result.current.applyCanonicalDraft({ projectScope: 'Conflicting version four value' }, 4);
    });

    expect(applied).toBe(false);
    expect(result.current.draft.projectScope).toBe('First version four value');
    expect(result.current.draftVersion).toBe(4);
  });

  test('ignores a deferred chat draft result after reset', async () => {
    const pendingUpdate = deferred<{
      ok: true; draftVersion: number; fieldCount: number; draft: Record<string, string>;
    }>();
    const updateProjectDraft = vi.fn(() => pendingUpdate.promise);
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true })),
      getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null), updateProjectDraft,
      resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });

    let mutation!: Promise<unknown>;
    act(() => { mutation = result.current.applyChatDraft({ projectScope: 'Stale chat scope' }); });
    await waitFor(() => expect(updateProjectDraft).toHaveBeenCalledOnce());
    act(() => result.current.reset());
    await act(async () => {
      pendingUpdate.resolve({ ok: true, draftVersion: 1, fieldCount: 1, draft: { projectScope: 'Stale chat scope' } });
      await mutation;
    });

    expect(result.current.draft.projectScope).toBe('');
    expect(result.current.draftVersion).toBe(0);
  });

  test('ignores a deferred edit result after replacing its session', async () => {
    const pendingUpdate = deferred<{
      ok: true; draftVersion: number; fieldCount: number; draft: Record<string, string>;
    }>();
    const createSession = vi.fn()
      .mockResolvedValueOnce({ sessionId: 'expired-session', status: 'new', sourceUrl: '', persisted: true, expiresAt: '2026-07-13T00:00:00.000Z' })
      .mockResolvedValueOnce({ sessionId: 'fresh-session', status: 'new', sourceUrl: '', persisted: true });
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession, getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: vi.fn(() => pendingUpdate.promise), resetProject: vi.fn(async () => true),
      requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });

    let mutation!: Promise<unknown>;
    act(() => { mutation = result.current.updateDraft('projectScope', 'Stale edit'); });
    await act(async () => { await result.current.loadOrCreateSession(); });
    await act(async () => {
      pendingUpdate.resolve({ ok: true, draftVersion: 1, fieldCount: 1, draft: { projectScope: 'Stale edit' } });
      await mutation;
    });

    expect(result.current.sessionId).toBe('fresh-session');
    expect(result.current.draft.projectScope).toBe('');
    expect(result.current.draftVersion).toBe(0);
  });

  test('returns no deferred edit result after unmount', async () => {
    const pendingUpdate = deferred<{
      ok: true; draftVersion: number; fieldCount: number; draft: Record<string, string>;
    }>();
    const { result, unmount } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true })),
      getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: vi.fn(() => pendingUpdate.promise), resetProject: vi.fn(async () => true),
      requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });

    let mutation!: Promise<unknown>;
    act(() => { mutation = result.current.updateDraft('projectScope', 'Late edit'); });
    unmount();
    pendingUpdate.resolve({ ok: true, draftVersion: 1, fieldCount: 1, draft: { projectScope: 'Late edit' } });

    await expect(mutation).resolves.toBeNull();
  });

  test('ignores an edit result older than the current canonical version', async () => {
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true })),
      getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: vi.fn(async () => ({ ok: true as const, draftVersion: 4, fieldCount: 1, draft: { projectScope: 'Older edit' } })),
      resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });
    act(() => result.current.applyCanonicalDraft({ projectScope: 'Current scope' }, 5));

    let mutation;
    await act(async () => { mutation = await result.current.updateDraft('projectScope', 'Older edit'); });

    expect(mutation).toBeNull();
    expect(result.current.draft.projectScope).toBe('Current scope');
    expect(result.current.draftVersion).toBe(5);
  });

  test('applies concurrent canonical results by draft version instead of request order', async () => {
    const higherVersion = deferred<{
      ok: true; draftVersion: number; fieldCount: number; draft: Record<string, string>;
    }>();
    const lowerVersion = deferred<{
      ok: true; draftVersion: number; fieldCount: number; draft: Record<string, string>;
    }>();
    const updateProjectDraft = vi.fn()
      .mockImplementationOnce(() => higherVersion.promise)
      .mockImplementationOnce(() => lowerVersion.promise);
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true })),
      getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null), updateProjectDraft,
      resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });

    let firstMutation!: Promise<unknown>;
    let secondMutation!: Promise<unknown>;
    act(() => {
      firstMutation = result.current.updateDraft('projectScope', 'Higher canonical version');
      secondMutation = result.current.updateDraft('projectScope', 'Lower canonical version');
    });
    await waitFor(() => expect(updateProjectDraft).toHaveBeenCalledTimes(2));

    await act(async () => {
      higherVersion.resolve({ ok: true, draftVersion: 2, fieldCount: 1, draft: { projectScope: 'Higher canonical version' } });
      await firstMutation;
    });
    await act(async () => {
      lowerVersion.resolve({ ok: true, draftVersion: 1, fieldCount: 1, draft: { projectScope: 'Lower canonical version' } });
      await secondMutation;
    });

    expect(result.current.draft.projectScope).toBe('Higher canonical version');
    expect(result.current.draftVersion).toBe(2);
  });

  test('hydrates restored reference links into the shared visible state', async () => {
    const restoredLinks = [{ kind: 'vimeo' as const, url: 'https://vimeo.com/123' }];
    const persistedLinks = [{ ...restoredLinks[0], id: 'reference-1', sessionId: 'session-1' }];
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => null), getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => ({ draftVersion: 3, fieldCount: 1, draft: { referencesStatus: 'added' }, referenceLinks: persistedLinks })),
      updateProjectDraft: vi.fn(), resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    await act(async () => { await result.current.hydrateDraft('session-1'); });
    expect(result.current.referenceLinks).toEqual(persistedLinks);
    act(() => result.current.appendReferenceLink({ id: 'reference-2', sessionId: 'session-1', kind: 'youtube', url: 'https://youtube.com/watch?v=1' }));
    expect(result.current.referenceLinks).toEqual([...persistedLinks, { id: 'reference-2', sessionId: 'session-1', kind: 'youtube', url: 'https://youtube.com/watch?v=1' }]);
  });

  test('hydrates reference-only sessions without replacing existing draft state', async () => {
    const persistedLinks = [{
      id: 'reference-only', sessionId: 'session-1', kind: 'vimeo' as const, url: 'https://vimeo.com/reference-only'
    }];
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => null), getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => ({ draftVersion: 0, fieldCount: 0, draft: {}, referenceLinks: persistedLinks })),
      updateProjectDraft: vi.fn(), resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => {
      result.current.setDraft({ ...result.current.draft, projectScope: 'Keep this local recovery value' });
      result.current.setDraftVersion(5);
    });

    await act(async () => { await result.current.hydrateDraft('session-1'); });

    expect(result.current.referenceLinks).toEqual(persistedLinks);
    expect(result.current.draft.projectScope).toBe('Keep this local recovery value');
    expect(result.current.draftVersion).toBe(5);
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

  test('releases a successful approval lock when a canonical edit requires reapproval', async () => {
    const updateProjectDraft = vi.fn(async () => ({
      ok: true as const,
      draftVersion: 5,
      fieldCount: 1,
      draft: { projectScope: 'Edited after approval' },
      provenance: { projectScope: 'confirmed' as const }
    }));
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => ({ sessionId: 'session-1', status: 'new', sourceUrl: '', persisted: true })),
      getCurrentSession: vi.fn(async () => null), fetchProjectDraft: vi.fn(async () => null), updateProjectDraft,
      resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });
    let firstApprovalToken!: number;
    act(() => {
      firstApprovalToken = result.current.beginApproval() as number;
      expect(firstApprovalToken).toEqual(expect.any(Number));
      result.current.finishApproval(firstApprovalToken, true);
      result.current.recordApproval({ approvedDraftVersion: 4 });
    });

    await act(async () => {
      expect(await result.current.updateDraft('projectScope', 'Edited after approval')).toMatchObject({ status: 'saved' });
    });

    expect(result.current.briefApproved).toBe(false);
    act(() => expect(result.current.beginApproval()).toEqual(expect.any(Number)));
  });

  test('invalidates a pending approval and ignores its stale completion after a reference edit', () => {
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => null), getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => null), updateProjectDraft: vi.fn(),
      resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));

    let staleToken!: number;
    act(() => {
      staleToken = result.current.beginApproval()!;
    });
    expect(staleToken).toEqual(expect.any(Number));
    expect(result.current.approvalInFlight).toBe(true);

    act(() => result.current.appendReferenceLink({
      id: 'reference-1', sessionId: 'session-1', kind: 'vimeo', url: 'https://vimeo.com/123'
    }));
    expect(result.current.approvalInFlight).toBe(false);
    expect(result.current.finishApproval(staleToken, true)).toBe(false);
    expect(result.current.briefApproved).toBe(false);

    let currentToken!: number;
    act(() => {
      currentToken = result.current.beginApproval()!;
      expect(result.current.finishApproval(currentToken, true)).toBe(true);
    });
    expect(result.current.briefApproved).toBe(true);
  });

  test('hydrates and replaces durable field provenance with canonical results', async () => {
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => null), getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => ({
        draftVersion: 3,
        fieldCount: 2,
        draft: { projectScope: 'My exact words', scopePolished: 'Generated summary' },
        provenance: { projectScope: 'user-stated' as const, scopePolished: 'inferred' as const }
      })),
      updateProjectDraft: vi.fn(), resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));

    await act(async () => { await result.current.hydrateDraft('session-1'); });

    expect(result.current.fieldProvenance).toEqual({ projectScope: 'user-stated', scopePolished: 'inferred' });
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

  test('replaces an expired active session and clears its expiration', async () => {
    const createSession = vi.fn()
      .mockResolvedValueOnce({ sessionId: 'expired-session', status: 'new', sourceUrl: '', persisted: true, expiresAt: '2026-07-13T10:00:00.000Z' })
      .mockResolvedValueOnce({ sessionId: 'fresh-session', status: 'new', sourceUrl: '', persisted: true });
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession,
      getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => null),
      updateProjectDraft: vi.fn(),
      resetProject: vi.fn(async () => true),
      requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    await act(async () => { await result.current.ensureSession(); });

    expect(result.current.isSessionExpired).toBe(true);

    await act(async () => { await result.current.loadOrCreateSession(); });

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(result.current.sessionId).toBe('fresh-session');
    expect(result.current.expiresAt).toBeNull();
    expect(result.current.isSessionExpired).toBe(false);
  });

  test('does not adopt a created session after reset and creates a fresh session on the next explicit bootstrap', async () => {
    const pendingCreate = deferred<{ sessionId: string; status: string; sourceUrl: string; persisted: boolean }>();
    const createSession = vi.fn()
      .mockImplementationOnce(() => pendingCreate.promise)
      .mockResolvedValueOnce({ sessionId: 'fresh-session', status: 'new', sourceUrl: '', persisted: true });
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession,
      getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft: vi.fn(async () => null), updateProjectDraft: vi.fn(), resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    let valid = true;
    let staleBootstrap!: Promise<string | null>;

    act(() => {
      staleBootstrap = result.current.ensureSession(() => valid);
    });
    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    act(() => {
      valid = false;
      result.current.reset();
    });
    await act(async () => {
      pendingCreate.resolve({ sessionId: 'stale-session', status: 'new', sourceUrl: '', persisted: true });
      await staleBootstrap;
    });

    expect(result.current.sessionId).toBeNull();
    valid = true;
    await act(async () => {
      expect(await result.current.ensureSession(() => valid)).toBe('fresh-session');
    });
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(result.current.sessionId).toBe('fresh-session');
  });

  test('does not adopt or hydrate a restored session after its bootstrap is invalidated', async () => {
    const pendingRestore = deferred<{ sessionId: string; status: string; sourceUrl: string } | null>();
    const getCurrentSession = vi.fn()
      .mockImplementationOnce(() => pendingRestore.promise)
      .mockResolvedValueOnce(null);
    const fetchProjectDraft = vi.fn(async () => null);
    const createSession = vi.fn(async () => ({ sessionId: 'fresh-restored-session', status: 'new', sourceUrl: '', persisted: true }));
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession, getCurrentSession, fetchProjectDraft,
      updateProjectDraft: vi.fn(), resetProject: vi.fn(async () => true), requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    act(() => result.current.setNoticeConsent(consent));
    let valid = true;
    let staleBootstrap!: Promise<string | null>;

    act(() => {
      staleBootstrap = result.current.loadOrCreateSession(() => valid);
    });
    await waitFor(() => expect(getCurrentSession).toHaveBeenCalledOnce());
    act(() => {
      valid = false;
      result.current.reset();
    });
    await act(async () => {
      pendingRestore.resolve({ sessionId: 'stale-restored-session', status: 'open', sourceUrl: '' });
      await staleBootstrap;
    });

    expect(result.current.sessionId).toBeNull();
    expect(fetchProjectDraft).not.toHaveBeenCalled();
    valid = true;
    await act(async () => {
      expect(await result.current.loadOrCreateSession(() => valid)).toBe('fresh-restored-session');
    });
    expect(getCurrentSession).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenCalledOnce();
    expect(result.current.sessionId).toBe('fresh-restored-session');
  });

  test('does not apply a deferred canonical hydration after hook invalidation', async () => {
    const pendingDraft = deferred<{
      sessionId: string;
      draftVersion: number;
      fieldCount: number;
      draft: Record<string, string>;
    } | null>();
    const fetchProjectDraft = vi.fn(() => pendingDraft.promise);
    const { result } = renderHook(() => useWidgetSessionDraft({
      createSession: vi.fn(async () => null),
      getCurrentSession: vi.fn(async () => null),
      fetchProjectDraft,
      updateProjectDraft: vi.fn(),
      resetProject: vi.fn(async () => true),
      requestProjectDeletion: vi.fn(async () => ({ ok: true }))
    }));
    let hydration!: Promise<void>;

    act(() => {
      hydration = result.current.hydrateDraft('session-1', () => true);
    });
    await waitFor(() => expect(fetchProjectDraft).toHaveBeenCalledOnce());
    act(() => result.current.invalidateBootstrap());
    await act(async () => {
      pendingDraft.resolve({
        sessionId: 'session-1',
        draftVersion: 4,
        fieldCount: 1,
        draft: { projectScope: 'STALE HYDRATED SCOPE' }
      });
      await hydration;
    });

    expect(result.current.draft.projectScope).toBe('');
    expect(result.current.draftVersion).toBe(0);
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

  test('keeps the current send pending when an uncorrelated team reply arrives', async () => {
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
    expect(result.current.status).toBe('sending');
    expect(result.current.waitingForReply).toBe(true);
    expect(result.current.isTeamConnected).toBe(true);
    expect(result.current.messages.map((message) => message.text)).toEqual(['Reply']);

    await act(async () => {
      pendingSend.resolve({ persisted: true, queued: true, delivered: false });
      await sendPromise;
    });
    expect(result.current.status).toBe('queued');
    expect(result.current.waitingForReply).toBe(true);
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

  test('promotes queued to delivered without attributing an incoming reply to the send', async () => {
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
    expect(result.current.status).toBe('delivered');
    expect(result.current.waitingForReply).toBe(true);
    expect(result.current.isTeamConnected).toBe(true);
  });

  test('keeps send B queued and waiting when a delayed reply to send A arrives', async () => {
    const poll = vi.fn()
      .mockResolvedValueOnce({ outgoingStatus: 'delivered' as const, messages: [{ id: 1, sender: 'team' as const, text: 'First reply', createdAt: '2026-07-16T10:00:00.000Z' }], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })
      .mockResolvedValueOnce({ outgoingStatus: 'queued' as const, messages: [{ id: 2, sender: 'team' as const, text: 'Delayed reply to A', createdAt: '2026-07-16T10:01:00.000Z' }], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
    const relay = vi.fn(async () => ({ persisted: true, queued: true, delivered: false }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: relay
    }));

    await act(async () => { await result.current.send('First message'); });
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('delivered');
    expect(result.current.isTeamConnected).toBe(true);

    await act(async () => { await result.current.send('Second message'); });
    expect(result.current.status).toBe('queued');
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('queued');
    expect(result.current.waitingForReply).toBe(true);
    expect(result.current.isTeamConnected).toBe(true);
    expect(result.current.messages.map((message) => message.text)).toEqual(['First reply', 'Delayed reply to A']);
    expect(poll.mock.calls.map(([, sinceId]) => sinceId)).toEqual([0, 1]);
  });

  test('reports terminal outgoing delivery as unavailable', async () => {
    const poll = vi.fn(async () => ({ outgoingStatus: 'unavailable' as const, messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false }));
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: vi.fn()
    }));

    await act(async () => { await result.current.poll(); });

    expect(result.current.status).toBe('unavailable');
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

  test('keeps incoming response evidence separate from later outgoing delivery evidence', async () => {
    const poll = vi.fn()
      .mockResolvedValueOnce({ outgoingStatus: 'queued', messages: [{ id: 1, sender: 'team' as const, text: 'Reply', createdAt: '2026-07-16T10:00:00.000Z' }], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false })
      .mockResolvedValueOnce({ outgoingStatus: 'delivered', messages: [], fileRequestOpen: false, fileRequestNote: null, scheduleRequestOpen: false });
    const { result } = renderHook(() => useTeamRelay({
      sessionId: 'session-1', fetchTeamMessages: poll, relayUserMessage: vi.fn()
    }));

    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('queued');
    expect(result.current.isTeamConnected).toBe(true);
    await act(async () => { await result.current.poll(); });
    expect(result.current.status).toBe('delivered');
    expect(result.current.isTeamConnected).toBe(true);
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
    expect(relay.mock.calls[0]?.[2]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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
    expect(result.current.status).toBe('requested');
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

  test('accepts the sanitized unavailable outgoing poll status', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      ...validPollResponse,
      outgoingStatus: 'unavailable'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(fetchTeamMessages('session-1')).resolves.toMatchObject({ outgoingStatus: 'unavailable' });
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
