import { getReviewPrompt, isBriefReadyForApproval, missingReviewFields } from '@/lib/conversation/review-state';
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

test('ready with only projectObjective and a contact detail', () => {
  const draft: Partial<LeadDraft> = {
    projectObjective: 'Increase awareness',
    contactEmail: 'jayden@example.com'
  };

  expect(isBriefReadyForApproval(draft)).toBe(true);
  expect(missingReviewFields(draft)).toEqual([]);
});

test('legacy scopePolished remains visible data but is not readiness evidence', () => {
  const draft: Partial<LeadDraft> = {
    scopePolished: 'AI interpretation of an otherwise empty brief',
    contactEmail: 'jayden@example.com'
  };

  expect(isBriefReadyForApproval(draft)).toBe(false);
  expect(missingReviewFields(draft)).toEqual(expect.arrayContaining(['projectScope', 'projectObjective', 'service']));
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

test('optional uncertainty values do not affect semantic readiness', () => {
  const draft: Partial<LeadDraft> = {
    projectScope: 'Launch film',
    contactName: 'Jayden',
    audience: 'Not sure yet',
    intendedOutputs: 'Skip',
    timelineBand: 'Prefer not to share',
    budgetBand: 'Not sure yet'
  };

  expect(isBriefReadyForApproval(draft)).toBe(true);
});

test('missingReviewFields returns individual empty required fields', () => {
  const draft = createDefaultLeadDraft();
  const missing = missingReviewFields(draft);
  expect(missing).toEqual(
    expect.arrayContaining([
      'projectScope',
      'projectObjective',
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

test('uses viewport-correct review prompts', () => {
  expect(getReviewPrompt(false)).toBe('Your core brief is ready. Review it in the brief panel.');
  expect(getReviewPrompt(true)).toBe('Your core brief is ready. Review it in the Brief tab.');
});
