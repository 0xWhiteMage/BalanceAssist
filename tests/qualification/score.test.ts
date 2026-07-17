import { scoreLead } from '@/lib/qualification/score';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

test('marks a relevant complete inquiry as qualified', () => {
  const result = scoreLead({
    ...createDefaultLeadDraft(),
    service: 'production',
    budgetBand: '50k-150k',
    timelineBand: '1-2-months',
    projectScope: 'Regional brand launch film',
    contactName: 'Jane Lee',
    contactEmail: 'jane@example.com'
  });

  expect(result.status).toBe('qualified');
});

test('marks an empty inquiry as unqualified', () => {
  const result = scoreLead({
    ...createDefaultLeadDraft(),
    service: '',
    projectScope: '',
    timelineBand: '',
    budgetBand: '',
    contactName: '',
    contactEmail: ''
  });

  expect(result.status).toBe('unqualified');
  expect(result.recommendedNextStep).toBe('human_followup');
});

test('marks a partial inquiry as needs review', () => {
  const result = scoreLead({
    ...createDefaultLeadDraft(),
    service: 'generative-ai',
    projectScope: 'AI concept exploration for launch visuals',
    timelineBand: 'asap',
    budgetBand: 'not-sure-yet',
    contactName: 'Casey',
    contactEmail: ''
  });

  expect(result.status).toBe('needs_review');
  expect(result.recommendedNextStep).toBe('manual_review');
});

test('marks a low-budget but specified inquiry as misfit', () => {
  const result = scoreLead({
    ...createDefaultLeadDraft(),
    service: 'not-sure-yet',
    projectScope: '',
    timelineBand: 'asap',
    budgetBand: 'under-20k',
    contactName: 'Taylor',
    contactEmail: ''
  });

  expect(result.status).toBe('misfit');
  expect(result.recommendedNextStep).toBe('redirect');
});

test('marks a non-empty inquiry with missing selectors as unqualified', () => {
  const result = scoreLead({
    ...createDefaultLeadDraft(),
    service: '',
    projectScope: 'Need help with a production brief',
    timelineBand: '',
    budgetBand: '',
    contactName: 'Alex',
    contactEmail: 'alex@example.com'
  });

  expect(result.status).toBe('unqualified');
});

test('keeps the qualified boundary at score 8', () => {
  const result = scoreLead({
    ...createDefaultLeadDraft(),
    service: 'production',
    projectScope: 'Launch visuals',
    timelineBand: '1-2-months',
    budgetBand: 'not-sure-yet',
    contactName: 'Dana',
    contactEmail: 'dana@example.com'
  });

  expect(result.score).toBe(8);
  expect(result.status).toBe('qualified');
});

test('keeps the needs review boundary at score 5', () => {
  const result = scoreLead({
    ...createDefaultLeadDraft(),
    service: 'not-sure-yet',
    projectScope: 'AI concept visuals',
    timelineBand: 'asap',
    budgetBand: 'not-sure-yet',
    contactName: 'Robin',
    contactEmail: ''
  });

  expect(result.score).toBe(5);
  expect(result.status).toBe('needs_review');
});
