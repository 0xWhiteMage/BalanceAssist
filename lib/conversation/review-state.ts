import type { LeadDraft } from '@/lib/onboarding/types';

export const REVIEW_PROMPT = 'Your brief is ready. Tap the tab on the right to review.';

export function missingReviewFields(draft: Partial<LeadDraft>): string[] {
  const missing: string[] = [];
  if (!draft.projectScope?.trim()) missing.push('projectScope');
  if (!draft.projectType?.trim() && !draft.service?.trim()) missing.push('projectType');
  if (!draft.timelineBand) missing.push('timelineBand');
  if (!draft.budgetBand) missing.push('budgetBand');
  if (!draft.contactName?.trim() && !draft.contactEmail?.trim()) missing.push('contact');
  return missing;
}

export function isBriefReadyForApproval(draft: Partial<LeadDraft>): boolean {
  return missingReviewFields(draft).length === 0;
}