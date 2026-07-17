'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';
import type { ConsentRecord } from '@/lib/privacy/notice';
import { detectProjectIntent } from '@/lib/conversation/project-intent';
import type { ProjectDraftResponse, SessionResponse } from '@/lib/api/client';

type DraftUpdate = { field: string; value: string; provenance: 'user-stated' | 'inferred' | 'confirmed' | 'cleared' };
type DraftUpdateResult = ({ ok: true } & ProjectDraftResponse) | ({ ok: false; conflict: true } & ProjectDraftResponse) | { ok: false; conflict: false };
type BootstrapValidity = () => boolean;
type VisibleReferenceLink = Pick<NonNullable<ProjectDraftResponse['referenceLinks']>[number], 'kind' | 'url'>;
export type DraftOperation = { invalidationEpoch: number; sessionId: string | null };

const alwaysValid: BootstrapValidity = () => true;

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
  const [referenceLinks, setReferenceLinks] = useState<VisibleReferenceLink[]>([]);
  const [approval, setApproval] = useState<{
    approvedDraftVersion?: number;
    approvalInputHash?: string;
    canonicalReferenceSetHash?: string;
    approvedReferenceSetHash?: string;
    crmRevision?: number;
  }>({});
  const sessionIdRef = useRef<string | null>(null);
  const expiresAtRef = useRef<string | null>(null);
  const draftRef = useRef(draft);
  const draftVersionRef = useRef(0);
  const bootstrapRef = useRef<Promise<string | null> | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const operationInvalidationEpochRef = useRef(0);
  const approveInFlightRef = useRef(false);
  const isExpired = (value: string | null | undefined) => value !== null && value !== undefined && Date.parse(value) <= Date.now();
  const isSessionExpired = isExpired(expiresAt);

  draftRef.current = draft;
  draftVersionRef.current = draftVersion;

  const invalidateBootstrap = useCallback(() => {
    bootstrapGenerationRef.current += 1;
    operationInvalidationEpochRef.current += 1;
    bootstrapRef.current = null;
  }, []);

  useEffect(() => invalidateBootstrap, [invalidateBootstrap]);

  const beginDraftOperation = useCallback((): DraftOperation => ({
    invalidationEpoch: operationInvalidationEpochRef.current,
    sessionId: sessionIdRef.current
  }), []);

  const isDraftOperationCurrent = useCallback((operation: DraftOperation) =>
    operation.invalidationEpoch === operationInvalidationEpochRef.current && operation.sessionId === sessionIdRef.current, []);

  const applyCanonicalDraft = useCallback((
    values: Record<string, string>,
    version: number,
    canonical?: ProjectDraftResponse,
    operation?: DraftOperation
  ) => {
    if (operation && !isDraftOperationCurrent(operation)) return false;
    if (version < draftVersionRef.current) return false;
    const nextDraft = { ...createDefaultLeadDraft(), ...values } as LeadDraft;
    const sameVersion = version === draftVersionRef.current;
    const sameDraft = Object.keys(nextDraft).every(
      (key) => nextDraft[key as keyof LeadDraft] === draftRef.current[key as keyof LeadDraft]
    );
    if (sameVersion && !sameDraft) return false;
    if (sameVersion && sameDraft && !canonical) return true;

    setDraft(nextDraft);
    draftRef.current = nextDraft;
    setDraftVersion(version);
    draftVersionRef.current = version;
    setHasProjectIntent(detectProjectIntent(nextDraft));
    if (canonical) {
      const nextApproval = {
        approvedDraftVersion: canonical.approvedDraftVersion,
        approvalInputHash: canonical.approvalInputHash,
        canonicalReferenceSetHash: canonical.canonicalReferenceSetHash,
        approvedReferenceSetHash: canonical.approvedReferenceSetHash,
        crmRevision: canonical.crmRevision
      };
      setApproval(nextApproval);
      setBriefApproved(
        nextApproval.approvedDraftVersion === version &&
        nextApproval.canonicalReferenceSetHash === nextApproval.approvedReferenceSetHash
      );
    } else {
      setBriefApproved(false);
    }
    return true;
  }, [isDraftOperationCurrent]);

  const appendReferenceLink = useCallback((link: VisibleReferenceLink) => {
    setReferenceLinks((current) => current.some((item) => item.url === link.url) ? current : [...current, link]);
  }, []);

  const setActiveSession = useCallback((session: SessionResponse, isValid: BootstrapValidity = alwaysValid) => {
    if (!isValid()) return false;
    if (sessionIdRef.current !== session.sessionId) operationInvalidationEpochRef.current += 1;
    sessionIdRef.current = session.sessionId;
    expiresAtRef.current = session.expiresAt ?? null;
    setSessionId(session.sessionId);
    setExpiresAt(session.expiresAt ?? null);
    setSessionUnavailable(false);
    return true;
  }, []);

  const hydrateDraft = useCallback(async (id: string, isValid: BootstrapValidity = alwaysValid) => {
    const generation = bootstrapGenerationRef.current;
    const operationIsValid = () => isValid() && generation === bootstrapGenerationRef.current;
    if (!operationIsValid()) return;
    const canonical = await dependencies.fetchProjectDraft(id);
    if (!operationIsValid()) return;
    if (canonical) {
      if (!operationIsValid()) return;
      setReferenceLinks((canonical.referenceLinks ?? []).map(({ kind, url }) => ({ kind, url })));
      if (canonical.draftVersion > 0 || Object.keys(canonical.draft).length > 0) {
        if (!operationIsValid()) return;
        applyCanonicalDraft(canonical.draft, canonical.draftVersion, canonical);
      }
    }
  }, [applyCanonicalDraft, dependencies]);

  const ensureSession = useCallback(async (isValid: BootstrapValidity = alwaysValid) => {
    const generation = bootstrapGenerationRef.current;
    const operationIsValid = () => isValid() && generation === bootstrapGenerationRef.current;
    if (!operationIsValid()) return null;
    if (sessionIdRef.current && !isExpired(expiresAtRef.current)) return sessionIdRef.current;
    if (sessionIdRef.current) {
      operationInvalidationEpochRef.current += 1;
      sessionIdRef.current = null;
      expiresAtRef.current = null;
      setSessionId(null);
      setExpiresAt(null);
    }
    if (!noticeConsent || typeof window === 'undefined') return null;
    const session = await dependencies.createSession({
      sourceUrl: window.location.href,
      referrer: document.referrer || undefined,
      consentVersion: noticeConsent.consentVersion,
      consentedAt: noticeConsent.consentedAt
    });
    if (!operationIsValid()) return null;
    if (!session?.sessionId || session.persisted !== true) {
      setSessionUnavailable(true);
      return null;
    }
    if (!setActiveSession(session, operationIsValid)) return null;
    return session.sessionId;
  }, [dependencies, noticeConsent, setActiveSession]);

  const loadOrCreateSession = useCallback((isValid: BootstrapValidity = alwaysValid) => {
    const generation = bootstrapGenerationRef.current;
    const operationIsValid = () => isValid() && generation === bootstrapGenerationRef.current;
    if (!operationIsValid()) return Promise.resolve(null);
    if (sessionIdRef.current && !isExpired(expiresAtRef.current)) return Promise.resolve(sessionIdRef.current);
    if (!noticeConsent || typeof window === 'undefined') return Promise.resolve(null);
    const runBootstrap = async () => {
      const current = await dependencies.getCurrentSession();
      if (!operationIsValid()) return null;
      if (current?.sessionId && !isExpired(current.expiresAt)) {
        if (!setActiveSession(current, operationIsValid)) return null;
        await hydrateDraft(current.sessionId, operationIsValid);
        return operationIsValid() ? current.sessionId : null;
      }
      return ensureSession(operationIsValid);
    };
    if (isValid !== alwaysValid) return runBootstrap();
    if (bootstrapRef.current) return bootstrapRef.current;
    const bootstrap = runBootstrap().finally(() => {
      if (bootstrapRef.current === bootstrap) bootstrapRef.current = null;
    });
    bootstrapRef.current = bootstrap;
    return bootstrap;
  }, [dependencies, ensureSession, hydrateDraft, noticeConsent, setActiveSession]);

  const persistDraft = useCallback(async (updates: DraftUpdate[], activeOperation?: DraftOperation) => {
    const id = sessionIdRef.current;
    if (!id || updates.length === 0) return null;
    const operation = activeOperation ?? beginDraftOperation();
    if (!isDraftOperationCurrent(operation)) return null;
    const result = await dependencies.updateProjectDraft(id, updates, draftVersionRef.current);
    if (!isDraftOperationCurrent(operation)) return null;
    if ('draft' in result && result.draft) {
      if (!applyCanonicalDraft(result.draft, result.draftVersion, undefined, operation)) return null;
    }
    return result;
  }, [applyCanonicalDraft, beginDraftOperation, dependencies, isDraftOperationCurrent]);

  const applyChatDraft = useCallback(async (updates: Record<string, string>) => {
    await persistDraft(Object.entries(updates)
      .filter(([, value]) => value.trim().length > 0)
      .map(([field, value]) => ({ field, value, provenance: 'inferred' as const })));
  }, [persistDraft]);

  const updateDraft = useCallback(async (field: string, value: string, operation?: DraftOperation) => {
    return persistDraft([{ field, value, provenance: value.trim() ? 'confirmed' : 'cleared' }], operation);
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

  const recordApproval = useCallback((result: { approvedDraftVersion?: number; crmRevision?: number }) => {
    setApproval((current) => ({
      ...current,
      approvedDraftVersion: result.approvedDraftVersion,
      crmRevision: result.crmRevision,
      approvedReferenceSetHash: current.canonicalReferenceSetHash
    }));
    setBriefApproved(true);
  }, []);

  const reset = useCallback(() => {
    invalidateBootstrap();
    sessionIdRef.current = null;
    expiresAtRef.current = null;
    draftVersionRef.current = 0;
    approveInFlightRef.current = false;
    setSessionId(null);
    setExpiresAt(null);
    setDraft(createDefaultLeadDraft());
    setDraftVersion(0);
    setHasProjectIntent(false);
    setBriefApproved(false);
    setReferenceLinks([]);
    setApproval({});
  }, [invalidateBootstrap]);

  return {
    noticeConsent, setNoticeConsent, sessionId, expiresAt, isSessionExpired, sessionUnavailable, draft, draftVersion,
    hasProjectIntent, briefApproved, setBriefApproved, ensureSession, loadOrCreateSession, invalidateBootstrap,
    applyCanonicalDraft, beginDraftOperation, isDraftOperationCurrent, applyChatDraft, updateDraft, approve, beginApproval, finishApproval, recordApproval, approval, referenceLinks, appendReferenceLink, reset,
    setSessionId, setDraft, setDraftVersion, setHasProjectIntent, hydrateDraft,
    resetProject: () => sessionIdRef.current ? dependencies.resetProject(sessionIdRef.current) : Promise.resolve(false),
    requestProjectDeletion: () => sessionIdRef.current ? dependencies.requestProjectDeletion(sessionIdRef.current) : Promise.resolve({ ok: false })
  };
}
