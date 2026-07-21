import { applyTextToDraft, getNextConversationStep } from '@/lib/conversation/extract';
import { conversationSteps } from '@/lib/conversation/flow';
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
  const draft = createDefaultLeadDraft();

  expect(getNextConversationStep(draft)).toBe('scope');
  expect(getNextConversationStep({ ...draft, service: 'production' })).toBe('objective');
  expect(getNextConversationStep({ ...draft, projectType: 'Animation' })).toBe('objective');
  expect(getNextConversationStep({ ...draft, projectScope: 'Launch film' })).toBe('objective');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness'
  })).toBe('audience');
  expect(getNextConversationStep({
    ...draft,
    projectType: 'Animation',
    projectObjective: 'Build awareness'
  })).toBe('audience');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness'
  })).toBe('audience');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness',
    service: 'production'
  })).toBe('audience');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness',
    service: 'production',
    audience: 'Young adults'
  })).toBe('outputs');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness',
    service: 'production',
    audience: 'Young adults',
    intendedOutputs: 'Hero film'
  })).toBe('timeline');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness',
    service: 'production',
    audience: 'Young adults',
    intendedOutputs: 'Hero film',
    timelineBand: 'Not sure yet'
  })).toBe('budget');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness',
    service: 'production',
    audience: 'Young adults',
    intendedOutputs: 'Hero film',
    timelineBand: 'Not sure yet',
    budgetBand: 'Prefer not to share'
  })).toBe('references');
  expect(conversationSteps.references.next).toBe('contact-name');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness',
    service: 'production',
    audience: 'Young adults',
    intendedOutputs: 'Hero film',
    timelineBand: 'Not sure yet',
    budgetBand: 'Prefer not to share',
    referencesStatus: 'skipped',
    contactName: 'Jane'
  })).toBe('contact-email');
  expect(getNextConversationStep({
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness',
    service: 'production',
    audience: 'Young adults',
    intendedOutputs: 'Hero film',
    timelineBand: 'Not sure yet',
    budgetBand: 'Prefer not to share',
    referencesStatus: 'added',
    contactName: 'Jane',
    contactEmail: 'jane@example.com'
  })).toBe('handoff');

  const planningComplete = {
    ...draft,
    projectScope: 'Launch film',
    projectObjective: 'Build awareness',
    audience: 'Young adults',
    intendedOutputs: 'Hero film',
    timelineBand: 'Not sure yet',
    budgetBand: 'Prefer not to share'
  };
  expect(getNextConversationStep({ ...planningComplete, contactName: 'Early Name' })).toBe('references');
  expect(getNextConversationStep({ ...planningComplete, contactEmail: 'early@example.com' })).toBe('references');
  expect(getNextConversationStep({ ...planningComplete, referencesStatus: 'skipped' })).toBe('contact-name');
});

test('handoff and contact flow avoid unproved producer review or follow-up promises', () => {
  const messagesFor = (step: typeof conversationSteps[keyof typeof conversationSteps]) =>
    typeof step.botMessages === 'function' ? step.botMessages(createDefaultLeadDraft()) : step.botMessages;
  const visibleCopy = [
    ...messagesFor(conversationSteps['contact-email']),
    ...messagesFor(conversationSteps.upload),
    ...messagesFor(conversationSteps.handoff)
  ].join(' ');

  expect(visibleCopy).not.toMatch(/producer.*(?:will|follow up)|team will review|will review everything/i);
});

test('captures canonical prose from its dedicated intake step', () => {
  const objective = applyTextToDraft(
    'Build awareness for the launch',
    createDefaultLeadDraft(),
    'objective'
  );
  const audience = applyTextToDraft('Young adults', objective, 'audience');
  const outputs = applyTextToDraft('Hero film and cut-downs', audience, 'outputs');

  expect(outputs.projectObjective).toBe('Build awareness for the launch');
  expect(outputs.audience).toBe('Young adults');
  expect(outputs.intendedOutputs).toBe('Hero film and cut-downs');
});

test('captures timeline and budget verbatim from their dedicated steps', () => {
  const timeline = applyTextToDraft(
    'Start August 3, final delivery September 18',
    createDefaultLeadDraft(),
    'timeline'
  );
  const budget = applyTextToDraft('SGD 40,000 to 60,000', timeline, 'budget');

  expect(budget.timelineBand).toBe('Start August 3, final delivery September 18');
  expect(budget.budgetBand).toBe('SGD 40,000 to 60,000');
});

test('uses stable prompts and excludes qualification from the user journey', () => {
  expect(conversationSteps.objective).toMatchObject({
    botMessages: ['What should this project achieve? Not sure yet is a valid answer.'],
    field: 'projectObjective',
    next: 'audience'
  });
  expect(conversationSteps.audience).toMatchObject({
    botMessages: ['Who is this for? You can choose Not sure yet or Skip.'],
    field: 'audience',
    next: 'outputs'
  });
  expect(conversationSteps.outputs).toMatchObject({
    botMessages: ['What outputs or deliverables do you expect? You can choose Not sure yet or Skip.'],
    field: 'intendedOutputs',
    next: 'timeline'
  });
  expect(conversationSteps.references).toMatchObject({
    botMessages: ['Would you like to share a reference? Add a public HTTPS link, describe what you have in mind, ask me for relevant Balance work, or choose Skip.'],
    next: 'contact-name'
  });
  expect(conversationSteps.timeline.botMessages).toEqual([
    expect.stringMatching(/start.*final delivery deadline.*exact dates/i)
  ]);
  expect(conversationSteps.budget.botMessages).toEqual([
    expect.stringMatching(/realistic formats.*scope|scope.*realistic formats/i)
  ]);
  expect(conversationSteps).not.toHaveProperty('qualification');
  expect(conversationSteps.consent.next).toBe('handoff');
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
