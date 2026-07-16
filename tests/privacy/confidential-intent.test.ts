import { describe, expect, test } from 'vitest';
import {
  classifyConfidentialFilename,
  classifyConfidentialIntent,
  CONFIDENTIAL_INTAKE_RESPONSE,
  type ConfidentialIntentResult
} from '@/lib/privacy/confidential-intent';

describe('classifyConfidentialIntent', () => {
  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['This project is under NDA.', 'nda'],
    ['These files are covered by a non-disclosure agreement', 'nda'],
    ['I need to share NDA-protected material', 'nda'],
    ['The attached brief contains confidential information.', 'confidential'],
    ['I am sending confidential client documents', 'confidential'],
    ['Our campaign details are strictly confidential', 'confidential'],
    ['This is an unreleased product campaign.', 'unreleased'],
    ['I want to upload pre-release footage', 'unreleased'],
    ['The project is unannounced media for launch', 'unreleased'],
    ['This file contains personal data.', 'personal-data'],
    ['I need to send identifying details', 'personal-data'],
    ['The brief includes private contact information', 'personal-data'],
    ['These documents contain sensitive information.', 'sensitive'],
    ['I am uploading sensitive client data', 'sensitive'],
    ['The attached material is highly sensitive', 'sensitive']
  ])('classifies %j as %s', (input, expected) => {
    expect(classifyConfidentialIntent(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['This brief is confidential.', 'confidential'],
    ['These files are confidential.', 'confidential'],
    ['I need to upload confidential documents.', 'confidential'],
    ['I am sharing an unreleased campaign.', 'unreleased'],
    ['I need to send personal data.', 'personal-data'],
    ['I am providing sensitive client information.', 'sensitive'],
    ['This work is covered by an NDA.', 'nda']
  ])('classifies common direct statement or action %j as %s', (input, expected) => {
    expect(classifyConfidentialIntent(input)).toBe(expected);
  });

  test.each<[string, 'personal-data']>([
    ['This file contains personally identifiable information.', 'personal-data'],
    ['I need to upload personally identifiable information.', 'personal-data']
  ])('classifies personally identifiable information %j as %s', (input, expected) => {
    expect(classifyConfidentialIntent(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['confidential-brief.pdf', 'confidential'],
    ['nda-protected-material.docx', 'nda'],
    ['unreleased-campaign.mov', 'unreleased'],
    ['personal-data.csv', 'personal-data'],
    ['sensitive-client-information.txt', 'sensitive']
  ])('classifies realistic filename %j as %s', (input, expected) => {
    expect(classifyConfidentialFilename(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['confidential.pdf', 'confidential'],
    ['nda_material.pdf', 'nda'],
    ['sensitive.pdf', 'sensitive'],
    ['personal-data.pdf', 'personal-data'],
    ['personally-identifiable-information.csv', 'personal-data'],
    ['unreleased.mov', 'unreleased'],
    ['pre-release-footage.mp4', 'unreleased'],
    ['unannounced_project.pdf', 'unreleased']
  ])('classifies standalone bounded filename label %j as %s', (input, expected) => {
    expect(classifyConfidentialFilename(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['confidential', 'confidential'],
    ['nda', 'nda'],
    ['sensitive', 'sensitive'],
    ['personal-data', 'personal-data'],
    ['unreleased', 'unreleased']
  ])('classifies extensionless exact protected filename label %j as %s', (input, expected) => {
    expect(classifyConfidentialFilename(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['2026-confidential-brief.pdf', 'confidential'],
    ['client-confidential-brief.pdf', 'confidential'],
    ['confidential-brief-final.pdf', 'confidential'],
    ['confidential.txt.pdf', 'confidential'],
    ['2026-nda-material.pdf', 'nda'],
    ['client-nda-material.pdf', 'nda'],
    ['nda-material-final.pdf', 'nda'],
    ['nda.txt.pdf', 'nda'],
    ['2026-sensitive-data.pdf', 'sensitive'],
    ['client-sensitive-data.pdf', 'sensitive'],
    ['sensitive-data-final.pdf', 'sensitive'],
    ['sensitive.txt.pdf', 'sensitive'],
    ['2026-personal-data.pdf', 'personal-data'],
    ['client-personal-data.pdf', 'personal-data'],
    ['personal-data-final.pdf', 'personal-data'],
    ['personal-data.txt.pdf', 'personal-data'],
    ['2026-unreleased-campaign.pdf', 'unreleased'],
    ['client-unreleased-campaign.pdf', 'unreleased'],
    ['unreleased-campaign-final.pdf', 'unreleased'],
    ['unreleased.txt.pdf', 'unreleased']
  ])('classifies bounded decorated filename %j as %s', (input, expected) => {
    expect(classifyConfidentialFilename(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['nightjar-confidential', 'confidential'],
    ['project-nightjar-confidential-brief', 'confidential'],
    ['candidate-confidential-brief.pdf', 'confidential'],
    ['confidential-unknown.pdf', 'confidential'],
    ['nda-confidential', 'nda'],
    ['nda-candidate.pdf', 'nda'],
    ['confidential-sensitive-data', 'confidential'],
    ['confidential-personal-data', 'confidential']
  ])('keeps filename classification monotonic with precedence for %j as %s', (input, expected) => {
    expect(classifyConfidentialFilename(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['.confidential', 'confidential'],
    ['confidential.', 'confidential'],
    ['confidential.pdf!', 'confidential']
  ])('scans the full normalized filename despite extension punctuation: %j', (input, expected) => {
    expect(classifyConfidentialFilename(input)).toBe(expected);
  });

  test.each([
    'not-confidential.txt',
    'no-personal-data.csv',
    'not-sensitive.pdf',
    'not-under-nda.docx',
    'already-released.mov',
    'guide-to-confidential-information.pdf',
    'sensitive-topic.txt',
    'confidential-information-policy.pdf',
    'nda-template.docx',
    'sensitive-data-template.csv',
    'personal-data-policy.pdf',
    'unreleased-content-policy.txt'
  ])('masks bounded filename negation or educational label %j', (input) => {
    expect(classifyConfidentialFilename(input)).toBe('allow');
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['not-confidential-sensitive-data.pdf', 'sensitive'],
    ['no-personal-data-confidential-brief.pdf', 'confidential'],
    ['not-sensitive-nda-material.pdf', 'nda'],
    ['not-under-nda-confidential.pdf', 'confidential'],
    ['already-released-unreleased-campaign.pdf', 'unreleased'],
    ['guide-to-confidential-information-nda-material.pdf', 'nda'],
    ['nda-template-confidential.pdf', 'confidential'],
    ['personal-data-policy-sensitive.pdf', 'sensitive']
  ])('keeps a separate positive filename phrase after masking %j as %s', (input, expected) => {
    expect(classifyConfidentialFilename(input)).toBe(expected);
  });

  test('fails closed when the normalized filename exceeds 512 characters', () => {
    expect(classifyConfidentialFilename('x'.repeat(513))).toBe('sensitive');
  });

  test('allows a benign normalized filename at the 512 character boundary', () => {
    expect(classifyConfidentialFilename('x'.repeat(512))).toBe('allow');
  });

  test('applies the length limit after removing default-ignorable code points', () => {
    expect(classifyConfidentialFilename(`${'\u200b'.repeat(513)}confidential`)).toBe('confidential');
  });

  test.each([
    'confidential.pdf',
    'nda_material.pdf',
    'sensitive.pdf',
    'personal-data.pdf',
    'unreleased.mov'
  ])('does not apply filename-only labels to prose classification: %j', (input) => {
    expect(classifyConfidentialIntent(input)).toBe('allow');
  });

  test.each([
    'personal-project.pdf',
    'private-event.pdf',
    'confidentially.pdf',
    'confidentiality.pdf',
    'sensitivity.pdf',
    'personalisation.pdf',
    'candidate.pdf',
    'unconditional.pdf',
    'release-form.pdf',
    'missing-extension',
    '2026-confidentiality-brief.pdf',
    'client-sensitivity-data.pdf',
    'personalisation-data-final.pdf',
    'release-form-final.pdf'
  ])('allows benign filename near-match %j', (input) => {
    expect(classifyConfidentialFilename(input)).toBe('allow');
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['This brief is confiden\u200btial.', 'confidential'],
    ['This file contains personal\u2060 data.', 'personal-data'],
    ['This project is under N\u200b.\u2060D.A.', 'nda'],
    ['I am sharing an unre\u2060leased campaign.', 'unreleased']
  ])('removes Unicode format characters before classifying %j as %s', (input, expected) => {
    expect(classifyConfidentialIntent(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['This brief is confiden\u034ftial.', 'confidential'],
    ['I am uploading sensi\ufe0ftive client data.', 'sensitive'],
    ['This file contains perso\u{e0100}nal data.', 'personal-data']
  ])('removes non-Cf default-ignorable code points before classifying %j as %s', (input, expected) => {
    expect(classifyConfidentialIntent(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['confiden\u034ftial.pdf', 'confidential'],
    ['n\ufe0fda_material.pdf', 'nda'],
    ['unre\u{e0100}leased.mov', 'unreleased']
  ])('removes default-ignorable code points from filename %j before classifying as %s', (input, expected) => {
    expect(classifyConfidentialFilename(input)).toBe(expected);
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['THIS PROJECT IS UNDER AN NDA', 'nda'],
    ['This\tproject\nis under NDA.', 'nda'],
    ['This project is under an N.D.A.', 'nda'],
    ['This project is under a non disclosure agreement', 'nda'],
    ['I am sharing pre–release footage', 'unreleased'],
    ["I’m sending confidential client documents", 'confidential']
  ])('normalizes case, whitespace, punctuation, apostrophes, and hyphenation: %j', (input, expected) => {
    expect(classifyConfidentialIntent(input)).toBe(expected);
  });

  test.each([
    'This is a personal project.',
    'That is a sensitive topic.',
    'We are planning a private event.',
    'How does Balance handle portfolio confidentiality?',
    'Can your producer review an NDA?',
    'This is not confidential.',
    'The project is no longer confidential.',
    'This contains no personal data.',
    'This document is not sensitive.',
    'The campaign has already been released.',
    'The candidate personalised the confidentially word.',
    'The class action is unconditional.',
    'We need a release form for filming.',
    'Please contact me about the project.'
  ])('allows benign, negated, and substring near-matches: %j', (input) => {
    expect(classifyConfidentialIntent(input)).toBe('allow');
  });

  test.each([
    'This project is not under NDA.',
    'These files are no longer covered by an NDA.',
    'This campaign is not unreleased.',
    'The footage is not pre-release.',
    'The project is no longer unannounced.',
    'This is not an unreleased campaign.',
    'This is no longer an unannounced project.',
    'I am not sharing pre-release footage.'
  ])('allows bounded NDA and unreleased negations: %j', (input) => {
    expect(classifyConfidentialIntent(input)).toBe('allow');
  });

  test.each([
    "I don't have any unreleased footage.",
    'We have no pre-release assets.',
    'I no longer have unannounced media.',
    'We are no longer sharing pre-release footage.',
    'The client is no longer sending unannounced media.'
  ])('allows natural unreleased possession and no-longer-sharing negations: %j', (input) => {
    expect(classifyConfidentialIntent(input)).toBe('allow');
  });

  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['This project is not under NDA, but the attached brief is confidential.', 'confidential'],
    ['The campaign is no longer unreleased, but this file contains personal data.', 'personal-data'],
    ['This footage is not pre-release, but I am sending sensitive client data.', 'sensitive'],
    ['This contains no personal data, but it is an unreleased campaign.', 'unreleased'],
    ["I don't have unreleased footage, but I am sending sensitive client data.", 'sensitive']
  ])('does not let a bounded negation hide a separate positive phrase: %j', (input, expected) => {
    expect(classifyConfidentialIntent(input)).toBe(expected);
  });

  test('does not let one negated phrase hide a separate positive phrase', () => {
    expect(
      classifyConfidentialIntent('The overview is not confidential, but the attached file contains personal data.')
    ).toBe('personal-data');
  });

  test('returns a stable non-echoing diversion message', () => {
    expect(CONFIDENTIAL_INTAKE_RESPONSE).toBe(
      'This channel cannot process confidential or sensitive material. Please use the human-only path to talk to the Balance team.'
    );
    expect(CONFIDENTIAL_INTAKE_RESPONSE).not.toMatch(/NDA-protected material/i);
  });
});
