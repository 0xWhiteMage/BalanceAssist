import { describe, expect, test } from 'vitest';
import {
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

  test.each([
    'THIS PROJECT IS UNDER AN NDA',
    'This\tproject\nis under NDA.',
    'This project is under an N.D.A.',
    'This project is under a non disclosure agreement',
    'I am sharing pre–release footage',
    "I’m sending confidential client documents"
  ])('normalizes case, whitespace, punctuation, apostrophes, and hyphenation: %j', (input) => {
    expect(classifyConfidentialIntent(input)).not.toBe('allow');
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
