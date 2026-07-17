import {
  createSessionPayloadSchema,
  chatResponsePayloadSchema,
  chatRequestPayloadSchema,
  MAX_CHAT_CAPTURED_FIELDS,
  MAX_CHAT_CAPTURED_FIELD_CHARACTERS,
  MAX_CHAT_CONTEXT_DRAFT_CHARACTERS,
  MAX_CHAT_CONTEXT_SESSION_ID_CHARACTERS,
  MAX_CHAT_CONTEXT_STEP_CHARACTERS
} from '@/lib/api/contracts';
import { expect, test } from 'vitest';

test('validates a session create payload', () => {
  const result = createSessionPayloadSchema.safeParse({
    sourceUrl: 'https://www.balancestudio.tv',
    consentVersion: '2026-07-11',
    consentedAt: '2026-07-11T10:00:00.000Z'
  });
  expect(result.success).toBe(true);
});

test('session create payload rejects when notice consent is missing', () => {
  const result = createSessionPayloadSchema.safeParse({ sourceUrl: 'https://www.balancestudio.tv' });
  expect(result.success).toBe(false);
});

test('chat response payload accepts a single message', () => {
  const result = chatResponsePayloadSchema.safeParse({ message: 'hello' });
  expect(result.success).toBe(true);
});

test('chat response payload accepts a multi-bubble messages array', () => {
  const result = chatResponsePayloadSchema.safeParse({ messages: ['one', 'two', 'three'] });
  expect(result.success).toBe(true);
});

test('chat response payload validates the confidential diversion outcome', () => {
  expect(chatResponsePayloadSchema.safeParse({
    message: 'Use the human-only path.',
    outcome: 'confidential_diversion'
  }).success).toBe(true);
  expect(chatResponsePayloadSchema.safeParse({
    message: 'Use the human-only path.',
    outcome: 'unknown_outcome'
  }).success).toBe(false);
});

test('chat response payload rejects when neither message nor messages is present', () => {
  const result = chatResponsePayloadSchema.safeParse({ draftUpdates: {} });
  expect(result.success).toBe(false);
});

test('chat response payload rejects an empty messages array', () => {
  const result = chatResponsePayloadSchema.safeParse({ messages: [] });
  expect(result.success).toBe(false);
});

test('chat request payload accepts an array of conversation messages', () => {
  const result = chatRequestPayloadSchema.safeParse({
    messages: [{ role: 'user', content: 'hi' }],
    context: { step: 'intro' }
  });
  expect(result.success).toBe(true);
});

test('chat request payload rejects assistant messages from the browser', () => {
  const result = chatRequestPayloadSchema.safeParse({
    messages: [{ role: 'assistant', content: 'hi' }]
  });
  expect(result.success).toBe(false);
});

test('chat request payload rejects system messages from the browser', () => {
  const result = chatRequestPayloadSchema.safeParse({
    messages: [{ role: 'system', content: 'hi' }]
  });
  expect(result.success).toBe(false);
});

test('chat request payload rejects when messages is empty', () => {
  const result = chatRequestPayloadSchema.safeParse({ messages: [] });
  expect(result.success).toBe(false);
});

test('chat request payload rejects blank current user content', () => {
  const result = chatRequestPayloadSchema.safeParse({
    messages: [
      { role: 'user', content: 'Earlier project context' },
      { role: 'user', content: '  \n\t ' }
    ]
  });
  expect(result.success).toBe(false);
});

test('chat request payload bounds every accepted context field', () => {
  const valid = { messages: [{ role: 'user', content: 'hi' }] };
  const oversizedContexts = [
    { step: 'x'.repeat(MAX_CHAT_CONTEXT_STEP_CHARACTERS + 1) },
    { draft: 'x'.repeat(MAX_CHAT_CONTEXT_DRAFT_CHARACTERS + 1) },
    { sessionId: 'x'.repeat(MAX_CHAT_CONTEXT_SESSION_ID_CHARACTERS + 1) },
    { capturedFields: Array.from({ length: MAX_CHAT_CAPTURED_FIELDS + 1 }, () => 'field') },
    { capturedFields: ['x'.repeat(MAX_CHAT_CAPTURED_FIELD_CHARACTERS + 1)] }
  ];

  for (const context of oversizedContexts) {
    expect(chatRequestPayloadSchema.safeParse({ ...valid, context }).success).toBe(false);
  }
});
