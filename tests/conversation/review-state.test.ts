import { isBriefReadyForApproval, REVIEW_PROMPT, missingReviewFields } from '@/lib/conversation/review-state';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

test('not ready when fields missing', () => {
  const draft = createDefaultLeadDraft();
  expect(isBriefReadyForApproval(draft)).toBe(false);
  expect(missingReviewFields(draft).length).toBeGreaterThan(0);
});

test('ready requires all 8 visible rows to be filled', () => {
  const draft = {
    service: 'production',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    timelineBand: '3 weeks',
    budgetBand: '$20,000 SGD',
    contactName: 'Jayden',
    contactCompany: 'Samsung',
    contactEmail: 'jayden@example.com'
  };
  expect(isBriefReadyForApproval(draft)).toBe(true);
  expect(missingReviewFields(draft)).toEqual([]);
});

test('not ready when only projectType is set (no service)', () => {
  const draft = {
    service: '',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    timelineBand: '3 weeks',
    budgetBand: '$20,000 SGD',
    contactName: 'Jayden',
    contactCompany: 'Samsung',
    contactEmail: 'jayden@example.com'
  };
  expect(isBriefReadyForApproval(draft)).toBe(false);
  expect(missingReviewFields(draft)).toContain('service');
});

test('not ready when contactName is set but contactEmail is empty', () => {
  const draft = {
    service: 'production',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    timelineBand: '3 weeks',
    budgetBand: '$20,000 SGD',
    contactName: 'Jayden',
    contactCompany: 'Samsung',
    contactEmail: ''
  };
  expect(isBriefReadyForApproval(draft)).toBe(false);
  expect(missingReviewFields(draft)).toContain('contactEmail');
});

test('missingReviewFields returns one entry per empty visible row (8 total)', () => {
  const draft = createDefaultLeadDraft();
  const missing = missingReviewFields(draft);
  expect(missing).toHaveLength(8);
  expect(missing).toEqual(
    expect.arrayContaining([
      'projectScope',
      'projectType',
      'service',
      'timelineBand',
      'budgetBand',
      'contactName',
      'contactCompany',
      'contactEmail'
    ])
  );
});

test('exports the review prompt', () => {
  expect(REVIEW_PROMPT).toBe('Your brief is ready. Review it in the panel on the left.');
});