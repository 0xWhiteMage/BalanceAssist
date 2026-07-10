import type { LeadDraft } from '@/lib/onboarding/types';

export const REVIEW_PROMPT = 'Your brief is ready. Tap the tab on the right to review.';

export function missingReviewFields(draft: Partial<LeadDraft>): string[] {
  const missing: string[] = [];
  if (!draft.projectScope?.trim()) missing.push('projectScope');
  if (!draft.projectType?.trim()) missing.push('projectType');
  if (!draft.service?.trim()) missing.push('service');
  if (!draft.timelineBand?.trim()) missing.push('timelineBand');
  if (!draft.budgetBand?.trim()) missing.push('budgetBand');
  if (!draft.contactName?.trim()) missing.push('contactName');
  if (!draft.contactCompany?.trim()) missing.push('contactCompany');
  if (!draft.contactEmail?.trim()) missing.push('contactEmail');
  return missing;
}

export function isBriefReadyForApproval(draft: Partial<LeadDraft>): boolean {
  return missingReviewFields(draft).length === 0;
}