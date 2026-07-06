import { isBriefReadyForApproval, REVIEW_PROMPT, missingReviewFields } from '@/lib/conversation/review-state';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

test('not ready when fields missing', () => {
  const draft = createDefaultLeadDraft();
  expect(isBriefReadyForApproval(draft)).toBe(false);
  expect(missingReviewFields(draft).length).toBeGreaterThan(0);
});

test('ready when all reviewable fields are present', () => {
  const draft = {
    service: 'production',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    timelineBand: '1-2-months',
    budgetBand: '20k-50k',
    contactName: 'Jayden',
    contactCompany: 'Samsung',
    contactEmail: 'jayden@example.com'
  };
  expect(isBriefReadyForApproval(draft)).toBe(true);
  expect(missingReviewFields(draft)).toEqual([]);
});

test('exports the review prompt', () => {
  expect(REVIEW_PROMPT).toBe('Your brief is ready. Tap the tab on the right to review.');
});