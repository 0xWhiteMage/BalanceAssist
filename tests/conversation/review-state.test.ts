import { isBriefReadyForApproval, REVIEW_PROMPT, missingReviewFields } from '@/lib/conversation/review-state';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';

test('not ready when fields missing', () => {
  const draft = createDefaultLeadDraft();
  expect(isBriefReadyForApproval(draft)).toBe(false);
  expect(missingReviewFields(draft).length).toBeGreaterThan(0);
});

test('ready requires at least one project need and one contact method', () => {
  const draft: Partial<LeadDraft> = {
    service: 'production',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    contactName: 'Jayden',
    contactEmail: 'jayden@example.com'
  };
  expect(isBriefReadyForApproval(draft)).toBe(true);
  expect(missingReviewFields(draft)).toEqual([]);
});

test('not ready when service is empty and projectScope is empty', () => {
  const draft: Partial<LeadDraft> = {
    service: '',
    projectType: 'Video',
    projectScope: '',
    scopePolished: '30s animation',
    timelineBand: '3 weeks',
    budgetBand: '$20,000 SGD',
    contactName: 'Jayden',
    contactCompany: 'Samsung',
    contactEmail: 'jayden@example.com'
  };
  expect(isBriefReadyForApproval(draft)).toBe(false);
  expect(missingReviewFields(draft)).toContain('service');
  expect(missingReviewFields(draft)).toContain('projectScope');
});

test('not ready when contactName and contactEmail are both empty', () => {
  const draft: Partial<LeadDraft> = {
    service: 'production',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    timelineBand: '3 weeks',
    budgetBand: '$20,000 SGD',
    contactName: '',
    contactCompany: 'Samsung',
    contactEmail: ''
  };
  expect(isBriefReadyForApproval(draft)).toBe(false);
  expect(missingReviewFields(draft)).toContain('contactName');
  expect(missingReviewFields(draft)).toContain('contactEmail');
});

test('ready with only projectScope (no service)', () => {
  const draft: Partial<LeadDraft> = {
    service: '',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    contactName: 'Jayden',
    contactEmail: 'jayden@example.com'
  };
  expect(isBriefReadyForApproval(draft)).toBe(true);
  expect(missingReviewFields(draft)).toEqual([]);
});

test('ready with only contactName (no email)', () => {
  const draft: Partial<LeadDraft> = {
    service: 'production',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    contactName: 'Jayden',
    contactEmail: '',
    contactCompany: 'Samsung'
  };
  expect(isBriefReadyForApproval(draft)).toBe(true);
  expect(missingReviewFields(draft)).toEqual([]);
});

test('ready with unknown timeline and budget', () => {
  const draft: Partial<LeadDraft> = {
    service: 'production',
    projectType: 'Video',
    projectScope: '30s animation',
    scopePolished: '30s animation',
    timelineBand: 'unknown',
    budgetBand: 'prefer not to say',
    contactName: 'Jayden',
    contactEmail: 'jayden@example.com'
  };
  expect(isBriefReadyForApproval(draft)).toBe(true);
  expect(missingReviewFields(draft)).toEqual([]);
});

test('missingReviewFields returns individual empty required fields', () => {
  const draft = createDefaultLeadDraft();
  const missing = missingReviewFields(draft);
  expect(missing).toEqual(
    expect.arrayContaining([
      'projectScope',
      'service',
      'contactName',
      'contactEmail'
    ])
  );
});

test('missingReviewFields does not require contactCompany, timelineBand, or budgetBand', () => {
  const draft: Partial<LeadDraft> = {
    service: 'production',
    projectScope: '30s animation',
    contactName: 'Jayden',
    contactEmail: 'jayden@example.com'
  };
  const missing = missingReviewFields(draft);
  expect(missing).not.toContain('contactCompany');
  expect(missing).not.toContain('timelineBand');
  expect(missing).not.toContain('budgetBand');
});

test('exports the review prompt', () => {
  expect(REVIEW_PROMPT).toBe('Your brief is ready. Review it in the panel on the left.');
});
