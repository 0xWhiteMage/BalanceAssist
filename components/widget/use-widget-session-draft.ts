'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';
import type { ConsentRecord } from '@/lib/privacy/notice';
import { detectProjectIntent } from '@/lib/conversation/project-intent';
import type { DeletionReceiptStatus, ProjectDraftResponse, ResetProjectResult, SessionResponse } from '@/lib/api/client';

type DraftUpdate = { field: string; value: string; provenance: 'user-stated' | 'inferred' | 'confirmed' | 'cleared' };
type DraftUpdateResult = ({ ok: true } & ProjectDraftResponse) | ({ ok: false; conflict: true } & ProjectDraftResponse) | { ok: false; conflict: false };
type BootstrapValidity = () => boolean;
type VisibleReferenceLink = NonNullable<ProjectDraftResponse['referenceLinks']>[number];
export type DraftEditOutcome =
  | { status: 'saved'; ok: true }
  | { status: 'conflict'; ok: false; conflict: true; message: string }
  | { status: 'failed'; ok: false; conflict: false; message: string };
export type DraftOperation = { invalidationEpoch: number; sessionId: string | null };
export type ApprovalStatus = 'idle' | 'pending' | 'error' | 'approved';
export type ApprovalToken = {
  generation: number;
  sessionId: string | null;
  draftVersion: number;
  canonicalReferenceSetHash?: string;
};
type ApprovalServerFacts = {
  approvedDraftVersion: number;
  approvalInputHash: string;
  approvedReferenceSetHash: string;
  crmRevision?: number;
};

const alwaysValid: BootstrapValidity = () => true;
const EMPTY_REFERENCE_SET_HASH = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';

type Dependencies = {
  createSession: (payload: { sourceUrl: string; referrer?: string; consentVersion?: string; consentedAt?: string }) => Promise<SessionResponse | null>;
  getCurrentSession: () => Promise<SessionResponse | null>;
  fetchProjectDraft: (sessionId: string) => Promise<ProjectDraftResponse | null>;
  updateProjectDraft: (sessionId: string, fields: DraftUpdate[], expectedDraftVersion?: number) => Promise<DraftUpdateResult>;
  resetProject: (sessionId: string) => Promise<boolean | ResetProjectResult>;
  requestProjectDeletion: (sessionId: string) => Promise<DeletionReceiptStatus>;
};

export function useWidgetSessionDraft(dependencies: Dependencies) {
  const [noticeConsent, setNoticeConsent] = useState<ConsentRecord | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [draft, setDraft] = useState<LeadDraft>(createDefaultLeadDraft());
  const [fieldProvenance, setFieldProvenance] = useState<NonNullable<ProjectDraftResponse['provenance']>>({});
  const [draftVersion, setDraftVersion] = useState(0);
  const [hasProjectIntent, setHasProjectIntent] = useState(false);
  const [briefApproved, setBriefApproved] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('idle');
  const [referenceLinks, setReferenceLinks] = useState<VisibleReferenceLink[]>([]);
  const [approval, setApproval] = useState<{
    approvedDraftVersion?: number;
    approvalInputHash?: string;
    canonicalReferenceSetHash?: string;
    approvedReferenceSetHash?: string;
    crmRevision?: number;
  }>({ canonicalReferenceSetHash: EMPTY_REFERENCE_SET_HASH });
  const sessionIdRef = useRef<string | null>(null);
  const expiresAtRef = useRef<string | null>(null);
  const draftRef = useRef(draft);
  const draftVersionRef = useRef(0);
  const bootstrapRef = useRef<Promise<string | null> | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const operationInvalidationEpochRef = useRef(0);
  const approvalStatusRef = useRef<ApprovalStatus>('idle');
  const approvalGenerationRef = useRef(0);
  const approvalRef = useRef(approval);
  const isExpired = (value: string | null | undefined) => value !== null && value !== undefined && Date.parse(value) <= Date.now();
  const isSessionExpired = isExpired(expiresAt);

  draftRef.current = draft;
  draftVersionRef.current = draftVersion;
  approvalRef.current = approval;

  const invalidateBootstrap = useCallback(() => {
    bootstrapGenerationRef.current += 1;
    operationInvalidationEpochRef.current += 1;
    bootstrapRef.current = null;
  }, []);

  useEffect(() => () => {
    invalidateBootstrap();
    approvalGenerationRef.current += 1;
    approvalStatusRef.current = 'idle';
  }, [invalidateBootstrap]);

  const transitionApproval = useCallback((status: ApprovalStatus) => {
    approvalStatusRef.current = status;
    setApprovalStatus(status);
    setBriefApproved(status === 'approved');
  }, []);

  const clearCanonicalState = useCallback(() => {
    const emptyDraft = createDefaultLeadDraft();
    const emptyApproval = { canonicalReferenceSetHash: EMPTY_REFERENCE_SET_HASH };
    draftRef.current = emptyDraft;
    draftVersionRef.current = 0;
    approvalRef.current = emptyApproval;
    approvalGenerationRef.current += 1;
    approvalStatusRef.current = 'idle';
    setDraft(emptyDraft);
    setFieldProvenance({});
    setDraftVersion(0);
    setHasProjectIntent(false);
    setBriefApproved(false);
    setApprovalStatus('idle');
    setReferenceLinks([]);
    setApproval(emptyApproval);
  }, []);

  const beginDraftOperation = useCallback((): DraftOperation => ({
    invalidationEpoch: operationInvalidationEpochRef.current,
    sessionId: sessionIdRef.current
  }), []);

  const isDraftOperationCurrent = useCallback((operation: DraftOperation) =>
    operation.invalidationEpoch === operationInvalidationEpochRef.current && operation.sessionId === sessionIdRef.current, []);

  const applyCanonicalApproval = useCallback((canonical: ProjectDraftResponse, version: number) => {
    approvalGenerationRef.current += 1;
    const nextApproval = {
      approvedDraftVersion: canonical.approvedDraftVersion,
      approvalInputHash: canonical.approvalInputHash,
      canonicalReferenceSetHash: canonical.canonicalReferenceSetHash,
      approvedReferenceSetHash: canonical.approvedReferenceSetHash,
      crmRevision: canonical.crmRevision
    };
    approvalRef.current = nextApproval;
    setApproval(nextApproval);
    const canonicalApproved =
      version === draftVersionRef.current &&
      nextApproval.approvedDraftVersion === version &&
      nextApproval.canonicalReferenceSetHash === nextApproval.approvedReferenceSetHash;
    transitionApproval(canonicalApproved ? 'approved' : 'idle');
  }, [transitionApproval]);

  const applyCanonicalDraft = useCallback((
    values: Record<string, string>,
    version: number,
    canonical?: ProjectDraftResponse,
    operation?: DraftOperation,
    provenance?: ProjectDraftResponse['provenance']
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
    setFieldProvenance(provenance ?? canonical?.provenance ?? {});
    setHasProjectIntent(detectProjectIntent(nextDraft));
    if (canonical) {
      applyCanonicalApproval(canonical, version);
    } else {
      approvalGenerationRef.current += 1;
      transitionApproval('idle');
    }
    return true;
  }, [applyCanonicalApproval, isDraftOperationCurrent, transitionApproval]);

  const appendReferenceLink = useCallback((link: VisibleReferenceLink) => {
    setReferenceLinks((current) => current.some((item) => item.url === link.url) ? current : [...current, link]);
    approvalGenerationRef.current += 1;
    transitionApproval('idle');
  }, [transitionApproval]);

  const removeReferenceLink = useCallback((linkId: string) => {
    setReferenceLinks((current) => current.filter((link) => link.id !== linkId));
    approvalGenerationRef.current += 1;
    transitionApproval('idle');
  }, [transitionApproval]);

  const setActiveSession = useCallback((session: SessionResponse, isValid: BootstrapValidity = alwaysValid) => {
    if (!isValid()) return false;
    if (sessionIdRef.current !== session.sessionId) {
      operationInvalidationEpochRef.current += 1;
      clearCanonicalState();
    }
    sessionIdRef.current = session.sessionId;
    expiresAtRef.current = session.expiresAt ?? null;
    setSessionId(session.sessionId);
    setExpiresAt(session.expiresAt ?? null);
    setSessionUnavailable(false);
    return true;
  }, [clearCanonicalState]);

  const hydrateDraft = useCallback(async (id: string, isValid: BootstrapValidity = alwaysValid) => {
    const generation = bootstrapGenerationRef.current;
    const operationIsValid = () => isValid() && generation === bootstrapGenerationRef.current;
    if (!operationIsValid() || (sessionIdRef.current !== null && id !== sessionIdRef.current)) return;
    const canonical = await dependencies.fetchProjectDraft(id);
    if (!operationIsValid() || (sessionIdRef.current !== null && id !== sessionIdRef.current)) return;
    if (canonical) {
      if (!operationIsValid()) return;
      if (canonical.draftVersion === 0 && Object.keys(canonical.draft).length === 0) clearCanonicalState();
      setReferenceLinks(canonical.referenceLinks ?? []);
      if (!operationIsValid()) return;
      applyCanonicalDraft(canonical.draft, canonical.draftVersion, canonical);
    }
  }, [applyCanonicalDraft, clearCanonicalState, dependencies]);

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
      clearCanonicalState();
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
  }, [clearCanonicalState, dependencies, noticeConsent, setActiveSession]);

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
      if (!applyCanonicalDraft(result.draft, result.draftVersion, undefined, operation, result.provenance)) return null;
    }
    return result;
  }, [applyCanonicalDraft, beginDraftOperation, dependencies, isDraftOperationCurrent]);

  const applyChatDraft = useCallback(async (updates: Record<string, string>) => {
    await persistDraft(Object.entries(updates)
      .filter(([, value]) => value.trim().length > 0)
      .map(([field, value]) => ({ field, value, provenance: 'inferred' as const })));
  }, [persistDraft]);

  const updateDraft = useCallback(async (field: string, value: string, operation?: DraftOperation) => {
    const result = await persistDraft([{ field, value, provenance: value.trim() ? 'confirmed' : 'cleared' }], operation);
    if (!result) return null;
    if (result.ok) return { status: 'saved', ok: true } as const;
    if (result.conflict) {
      return {
        status: 'conflict', ok: false, conflict: true,
        message: 'This brief changed elsewhere. I reloaded the latest saved value; please reapply your edit.'
      } as const;
    }
    return {
      status: 'failed', ok: false, conflict: false,
      message: 'This edit was not saved. Retry or cancel to keep the latest saved value.'
    } as const;
  }, [persistDraft]);

  const beginApproval = useCallback((): ApprovalToken | null => {
    if (approvalStatusRef.current === 'pending' || approvalStatusRef.current === 'approved') return null;
    const token = {
      generation: ++approvalGenerationRef.current,
      sessionId: sessionIdRef.current,
      draftVersion: draftVersionRef.current,
      canonicalReferenceSetHash: approvalRef.current.canonicalReferenceSetHash
    };
    transitionApproval('pending');
    return token;
  }, [transitionApproval]);

  const finishApproval = useCallback((token: ApprovalToken, status: Extract<ApprovalStatus, 'error' | 'approved'>) => {
    if (token.generation !== approvalGenerationRef.current) return false;
    transitionApproval(status);
    return true;
  }, [transitionApproval]);

  const finishApprovalSuccess = useCallback((token: ApprovalToken, facts: ApprovalServerFacts) => {
    if (token.generation !== approvalGenerationRef.current) return 'stale' as const;
    const currentReferenceHash = approvalRef.current.canonicalReferenceSetHash;
    if (
      token.sessionId !== sessionIdRef.current ||
      token.draftVersion !== draftVersionRef.current ||
      token.canonicalReferenceSetHash !== currentReferenceHash
    ) return 'stale' as const;
    if (
      facts.approvedDraftVersion !== token.draftVersion ||
      facts.approvedReferenceSetHash !== token.canonicalReferenceSetHash
    ) {
      transitionApproval('error');
      return 'mismatch' as const;
    }
    const nextApproval = {
      approvedDraftVersion: facts.approvedDraftVersion,
      approvalInputHash: facts.approvalInputHash,
      canonicalReferenceSetHash: currentReferenceHash,
      approvedReferenceSetHash: facts.approvedReferenceSetHash,
      crmRevision: facts.crmRevision
    };
    approvalRef.current = nextApproval;
    setApproval(nextApproval);
    transitionApproval('approved');
    return 'approved' as const;
  }, [transitionApproval]);

  const reset = useCallback(() => {
    invalidateBootstrap();
    sessionIdRef.current = null;
    expiresAtRef.current = null;
    setSessionId(null);
    setExpiresAt(null);
    clearCanonicalState();
  }, [clearCanonicalState, invalidateBootstrap]);

  const getDraftSnapshot = useCallback(() => draftRef.current, []);
  const reopenApproval = useCallback(() => transitionApproval('idle'), [transitionApproval]);

  return {
    noticeConsent, setNoticeConsent, sessionId, expiresAt, isSessionExpired, sessionUnavailable, draft, fieldProvenance, draftVersion,
    hasProjectIntent, briefApproved, approvalStatus, approvalInFlight: approvalStatus === 'pending', ensureSession, loadOrCreateSession, invalidateBootstrap,
    applyCanonicalDraft, beginDraftOperation, isDraftOperationCurrent, applyChatDraft, updateDraft, beginApproval, finishApproval, finishApprovalSuccess, approval, referenceLinks, appendReferenceLink, removeReferenceLink, reset, getDraftSnapshot, reopenApproval,
    setSessionId, setDraft, setDraftVersion, setHasProjectIntent, hydrateDraft,
    resetProject: () => sessionIdRef.current ? dependencies.resetProject(sessionIdRef.current) : Promise.resolve(false),
    requestProjectDeletion: () => sessionIdRef.current ? dependencies.requestProjectDeletion(sessionIdRef.current) : Promise.resolve({ ok: false })
  };
}
