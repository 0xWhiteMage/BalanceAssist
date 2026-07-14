'use client';

import { useCallback, useRef, useState } from 'react';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';
import type { ConsentRecord } from '@/lib/privacy/notice';
import { detectProjectIntent } from '@/lib/conversation/project-intent';
import type { ProjectDraftResponse, SessionResponse } from '@/lib/api/client';

type DraftUpdate = { field: string; value: string; provenance: 'user-stated' | 'inferred' | 'confirmed' | 'cleared' };
type DraftUpdateResult = ({ ok: true } & ProjectDraftResponse) | ({ ok: false; conflict: true } & ProjectDraftResponse) | { ok: false; conflict: false };

type Dependencies = {
  createSession: (payload: { sourceUrl: string; referrer?: string; consentVersion?: string; consentedAt?: string }) => Promise<SessionResponse | null>;
  getCurrentSession: () => Promise<SessionResponse | null>;
  fetchProjectDraft: (sessionId: string) => Promise<ProjectDraftResponse | null>;
  updateProjectDraft: (sessionId: string, fields: DraftUpdate[], expectedDraftVersion?: number) => Promise<DraftUpdateResult>;
  resetProject: (sessionId: string) => Promise<boolean>;
  requestProjectDeletion: (sessionId: string) => Promise<{ ok: boolean; message?: string }>;
};

export function useWidgetSessionDraft(dependencies: Dependencies) {
  const [noticeConsent, setNoticeConsent] = useState<ConsentRecord | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [draft, setDraft] = useState<LeadDraft>(createDefaultLeadDraft());
  const [draftVersion, setDraftVersion] = useState(0);
  const [hasProjectIntent, setHasProjectIntent] = useState(false);
  const [briefApproved, setBriefApproved] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const draftVersionRef = useRef(0);
  const bootstrapRef = useRef<Promise<string | null> | null>(null);
  const approveInFlightRef = useRef(false);

  const applyCanonicalDraft = useCallback((values: Record<string, string>, version: number) => {
    const nextDraft = { ...createDefaultLeadDraft(), ...values } as LeadDraft;
    setDraft(nextDraft);
    setDraftVersion(version);
    draftVersionRef.current = version;
    setHasProjectIntent(detectProjectIntent(nextDraft));
    setBriefApproved(false);
  }, []);

  const setActiveSession = useCallback((session: SessionResponse) => {
    sessionIdRef.current = session.sessionId;
    setSessionId(session.sessionId);
    setExpiresAt(session.expiresAt ?? null);
    setSessionUnavailable(false);
  }, []);

  const hydrateDraft = useCallback(async (id: string) => {
    const canonical = await dependencies.fetchProjectDraft(id);
    if (canonical && (canonical.draftVersion > 0 || Object.keys(canonical.draft).length > 0)) {
      applyCanonicalDraft(canonical.draft, canonical.draftVersion);
    }
  }, [applyCanonicalDraft, dependencies]);

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!noticeConsent || typeof window === 'undefined') return null;
    const session = await dependencies.createSession({
      sourceUrl: window.location.href,
      referrer: document.referrer || undefined,
      consentVersion: noticeConsent.consentVersion,
      consentedAt: noticeConsent.consentedAt
    });
    if (!session?.sessionId || session.persisted !== true) {
      setSessionUnavailable(true);
      return null;
    }
    setActiveSession(session);
    return session.sessionId;
  }, [dependencies, noticeConsent, setActiveSession]);

  const loadOrCreateSession = useCallback(() => {
    if (sessionIdRef.current) return Promise.resolve(sessionIdRef.current);
    if (!noticeConsent || typeof window === 'undefined') return Promise.resolve(null);
    if (bootstrapRef.current) return bootstrapRef.current;
    const bootstrap = (async () => {
      try {
        const current = await dependencies.getCurrentSession();
        if (current?.sessionId) {
          setActiveSession(current);
          await hydrateDraft(current.sessionId);
          return current.sessionId;
        }
        return await ensureSession();
      } finally {
        bootstrapRef.current = null;
      }
    })();
    bootstrapRef.current = bootstrap;
    return bootstrap;
  }, [dependencies, ensureSession, hydrateDraft, noticeConsent, setActiveSession]);

  const persistDraft = useCallback(async (updates: DraftUpdate[]) => {
    const id = sessionIdRef.current;
    if (!id || updates.length === 0) return null;
    const result = await dependencies.updateProjectDraft(id, updates, draftVersionRef.current);
    if ('draft' in result && result.draft) applyCanonicalDraft(result.draft, result.draftVersion);
    return result;
  }, [applyCanonicalDraft, dependencies]);

  const applyChatDraft = useCallback(async (updates: Record<string, string>) => {
    await persistDraft(Object.entries(updates)
      .filter(([, value]) => value.trim().length > 0)
      .map(([field, value]) => ({ field, value, provenance: 'inferred' as const })));
  }, [persistDraft]);

  const updateDraft = useCallback(async (field: string, value: string) => {
    return persistDraft([{ field, value, provenance: value.trim() ? 'confirmed' : 'cleared' }]);
  }, [persistDraft]);

  const approve = useCallback(async (operation: () => Promise<boolean>) => {
    if (approveInFlightRef.current || briefApproved) return false;
    approveInFlightRef.current = true;
    try {
      const approved = await operation();
      if (approved) setBriefApproved(true);
      return approved;
    } finally {
      if (!briefApproved) approveInFlightRef.current = false;
    }
  }, [briefApproved]);

  const beginApproval = useCallback(() => {
    if (approveInFlightRef.current || briefApproved) return false;
    approveInFlightRef.current = true;
    return true;
  }, [briefApproved]);

  const finishApproval = useCallback((approved: boolean) => {
    if (approved) setBriefApproved(true);
    else approveInFlightRef.current = false;
  }, []);

  const reset = useCallback(() => {
    sessionIdRef.current = null;
    draftVersionRef.current = 0;
    approveInFlightRef.current = false;
    setSessionId(null);
    setExpiresAt(null);
    setDraft(createDefaultLeadDraft());
    setDraftVersion(0);
    setHasProjectIntent(false);
    setBriefApproved(false);
  }, []);

  return {
    noticeConsent, setNoticeConsent, sessionId, expiresAt, sessionUnavailable, draft, draftVersion,
    hasProjectIntent, briefApproved, setBriefApproved, ensureSession, loadOrCreateSession,
    applyCanonicalDraft, applyChatDraft, updateDraft, approve, beginApproval, finishApproval, reset,
    setSessionId, setDraft, setDraftVersion, setHasProjectIntent, hydrateDraft,
    resetProject: () => sessionIdRef.current ? dependencies.resetProject(sessionIdRef.current) : Promise.resolve(false),
    requestProjectDeletion: () => sessionIdRef.current ? dependencies.requestProjectDeletion(sessionIdRef.current) : Promise.resolve({ ok: false })
  };
}
