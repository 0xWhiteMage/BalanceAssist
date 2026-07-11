export type AttachmentConsent = {
  aiAnalysis: boolean;
  producerShare: boolean;
  consentedAt: string;
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
  return consent.aiAnalysis === true && consent.producerShare === true;
}
