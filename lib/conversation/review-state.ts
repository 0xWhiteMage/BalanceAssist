import type { LeadDraft } from '@/lib/onboarding/types';

export const REVIEW_PROMPT = 'Your brief is ready. Review it in the panel on the left.';

export function missingReviewFields(draft: Partial<LeadDraft>): string[] {
  const missing: string[] = [];
  if (!draft.projectScope?.trim() && !draft.service?.trim()) {
    missing.push('projectScope');
    missing.push('service');
  }
  if (!draft.contactName?.trim() && !draft.contactEmail?.trim()) {
    missing.push('contactName');
    missing.push('contactEmail');
  }
  return missing;
}

export function isBriefReadyForApproval(draft: Partial<LeadDraft>): boolean {
  const hasProjectNeed = Boolean(draft.projectScope?.trim() || draft.service?.trim());
  const hasContactMethod = Boolean(draft.contactName?.trim() || draft.contactEmail?.trim());
  return hasProjectNeed && hasContactMethod;
}
