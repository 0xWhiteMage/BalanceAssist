import { applyTextToDraft, getNextConversationStep } from '@/lib/conversation/extract';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

test('extracts multiple structured fields from a natural project description', () => {
  const draft = applyTextToDraft(
    'We need a production shoot for a regional launch in 2 months and the budget is around 60k. My email is jane@example.com.',
    createDefaultLeadDraft(),
    'intro'
  );

  expect(draft.service).toBe('production');
  expect(draft.timelineBand).toBe('1-2-months');
  expect(draft.budgetBand).toBe('50k-150k');
  expect(draft.contactEmail).toBe('jane@example.com');
  expect(draft.projectScope).toContain('regional launch');
});

test('chooses the next missing conversation step dynamically', () => {
  expect(
    getNextConversationStep({
      service: 'production',
      projectScope: 'Regional launch film',
      timelineBand: '',
      budgetBand: '50k-150k',
      contactName: 'Jane',
      contactEmail: 'jane@example.com'
    })
  ).toBe('timeline');
});

test('captures a direct contact name response', () => {
  const draft = applyTextToDraft('Jane Lee', createDefaultLeadDraft(), 'contact-name');

  expect(draft.contactName).toBe('Jane Lee');
});
