import { normalizeVersionedDraft, updateField, type VersionedDraft } from '@/lib/conversation/draft-versioning';

export type AttachmentConsent = {
  aiAnalysis: boolean;
  producerShare: boolean;
  consentedAt: string;
};

export const ATTACHMENT_AI_ANALYSIS_CONSENT_FIELD = '__attachment_ai_analysis_consented_at';
export const ATTACHMENT_PRODUCER_SHARE_CONSENT_FIELD = '__attachment_producer_share_consented_at';

export type RecordedAttachmentConsent = {
  aiAnalysis: boolean;
  producerShare: boolean;
  consentedAt: string | null;
};

export function createAttachmentConsent(
  aiAnalysis: boolean,
  producerShare: boolean
): AttachmentConsent {
  return {
    aiAnalysis,
    producerShare,
    consentedAt: new Date().toISOString()
  };
}

export function hasRequiredConsent(consent: AttachmentConsent | null): boolean {
  if (!consent) return false;
  return consent.aiAnalysis === true || consent.producerShare === true;
}

export function hasAnalysisConsent(consent: AttachmentConsent | null): boolean {
  return consent?.aiAnalysis === true;
}

export function hasProducerShareConsent(consent: AttachmentConsent | null): boolean {
  return consent?.producerShare === true;
}

export function recordAttachmentConsent(draft: VersionedDraft, consent: AttachmentConsent | null): VersionedDraft {
  if (!consent) {
    return draft;
  }

  let nextDraft = draft;

  if (consent.aiAnalysis) {
    nextDraft = updateField(nextDraft, ATTACHMENT_AI_ANALYSIS_CONSENT_FIELD, consent.consentedAt, 'confirmed');
  }

  if (consent.producerShare) {
    nextDraft = updateField(nextDraft, ATTACHMENT_PRODUCER_SHARE_CONSENT_FIELD, consent.consentedAt, 'confirmed');
  }

  return nextDraft;
}

export function getRecordedAttachmentConsent(draft: unknown): RecordedAttachmentConsent {
  const normalizedDraft = normalizeVersionedDraft(draft);
  const analysisAt = normalizedDraft[ATTACHMENT_AI_ANALYSIS_CONSENT_FIELD]?.value ?? null;
  const producerShareAt = normalizedDraft[ATTACHMENT_PRODUCER_SHARE_CONSENT_FIELD]?.value ?? null;

  return {
    aiAnalysis: Boolean(analysisAt),
    producerShare: Boolean(producerShareAt),
    consentedAt: producerShareAt ?? analysisAt
  };
}
