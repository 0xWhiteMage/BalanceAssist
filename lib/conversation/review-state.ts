import type { LeadDraft } from '@/lib/onboarding/types';

export function getReviewPrompt(isMobile: boolean): string {
  return isMobile
    ? 'Your brief is ready to check before it is sent to Balance. Open the Brief tab to review it.'
    : 'Your brief is ready to check before it is sent to Balance. Review the brief panel before sending.';
}

export const REVIEW_PROMPT = getReviewPrompt(false);

export function missingReviewFields(draft: Partial<LeadDraft>): string[] {
  const missing: string[] = [];
  if (!draft.projectScope?.trim() && !draft.projectObjective?.trim() && !draft.service?.trim()) {
    missing.push('projectScope');
    missing.push('projectObjective');
    missing.push('service');
  }
  if (!draft.contactName?.trim() && !draft.contactEmail?.trim()) {
    missing.push('contactName');
    missing.push('contactEmail');
  }
  return missing;
}

export function isBriefReadyForApproval(draft: Partial<LeadDraft>): boolean {
  const hasProjectNeed = Boolean(
    draft.projectScope?.trim() || draft.projectObjective?.trim() || draft.service?.trim()
  );
  const hasContactMethod = Boolean(draft.contactName?.trim() || draft.contactEmail?.trim());
  return hasProjectNeed && hasContactMethod;
}
