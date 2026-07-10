import { applyTextToDraft, getNextConversationStep } from '@/lib/conversation/extract';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

test('extracts structured fields from a natural project description', () => {
  const draft = applyTextToDraft(
    'We need a production shoot for a regional launch in 2 months and the budget is around 60k. My email is jane@example.com.',
    createDefaultLeadDraft(),
    'intro'
  );

  expect(draft.service).toBe('production');
  expect(draft.contactEmail).toBe('jane@example.com');
  expect(draft.projectScope).toContain('regional launch');
  // Timeline and budget are no longer coerced from free text — they are set
  // ONLY via the AI tool call (record_brief_updates).
  expect(draft.timelineBand).toBe('');
  expect(draft.budgetBand).toBe('');
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

test('contact-email step does NOT capture "yes" as the email (low-info reply guard)', () => {
  const draft = applyTextToDraft('yes', createDefaultLeadDraft(), 'contact-email');
  expect(draft.contactEmail).toBe('');
});

test('contact-email step does NOT capture "ok" as the email (low-info reply guard)', () => {
  const draft = applyTextToDraft('ok', createDefaultLeadDraft(), 'contact-email');
  expect(draft.contactEmail).toBe('');
});

test('contact-email step DOES capture a well-formed email address', () => {
  const draft = applyTextToDraft('user@example.com', createDefaultLeadDraft(), 'contact-email');
  expect(draft.contactEmail).toBe('user@example.com');
});

test('intro step does NOT capture "Looking" as a contact name from "I\'m looking to inquire for a project"', () => {
  const draft = applyTextToDraft("I'm looking to inquire for a project", createDefaultLeadDraft(), 'intro');
  expect(draft.contactName).toBe('');
});

test('intro step does NOT capture "Interested" as a contact name from "I am interested in a project"', () => {
  const draft = applyTextToDraft('I am interested in a project', createDefaultLeadDraft(), 'intro');
  expect(draft.contactName).toBe('');
});
