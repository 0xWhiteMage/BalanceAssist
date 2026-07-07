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
  const draft = applyTextToDraft("my name is Jane Lee", createDefaultLeadDraft(), 'contact-name');

  expect(draft.contactName).toBe('Jane Lee');
});

test('contact-name step rejects raw text that has no explicit name pattern', () => {
  const draft = applyTextToDraft('yes, an event video', createDefaultLeadDraft(), 'contact-name');
  expect(draft.contactName).toBe('');
});

test('captures company name from natural phrasing', () => {
  const draft = applyTextToDraft(
    'I am John, I work at Acme Studios',
    createDefaultLeadDraft(),
    'scope'
  );

  expect(draft.contactName).toBe('John');
  expect((draft as { contactCompany?: string }).contactCompany).toBe('Acme Studios');
});

test('captures company name from "from" phrasing', () => {
  const draft = applyTextToDraft('Sarah from OpenAI Labs here', createDefaultLeadDraft(), 'scope');

  expect((draft as { contactCompany?: string }).contactCompany).toBe('OpenAI Labs');
});

test('does NOT capture projectScope for an out-of-scope "draft text for my homework" intro message', () => {
  const draft = applyTextToDraft(
    'can you help me draft text for my homework?',
    createDefaultLeadDraft(),
    'intro'
  );

  expect(draft.projectScope).toBe('');
});

test('does NOT capture projectScope for out-of-scope triggers (homework, recipe, therapy)', () => {
  expect(
    applyTextToDraft(
      'help me write a homework essay please',
      createDefaultLeadDraft(),
      'intro'
    ).projectScope
  ).toBe('');

  expect(
    applyTextToDraft(
      'I just want a recipe for chicken curry tonight',
      createDefaultLeadDraft(),
      'intro'
    ).projectScope
  ).toBe('');

  expect(
    applyTextToDraft(
      'I need emotional therapy advice about my mother',
      createDefaultLeadDraft(),
      'intro'
    ).projectScope
  ).toBe('');
});

test('DOES capture projectScope for an in-scope "30s 3D animation" intro message (positive case)', () => {
  const draft = applyTextToDraft(
    'I want a 30s 3D animation for our launch',
    createDefaultLeadDraft(),
    'intro'
  );

  expect(draft.projectScope).toContain('30s 3D animation');
});
