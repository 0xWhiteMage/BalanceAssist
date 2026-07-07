import { createSessionPayloadSchema, chatResponsePayloadSchema, chatRequestPayloadSchema } from '@/lib/api/contracts';
import { expect, test } from 'vitest';

test('validates a session create payload', () => {
  const result = createSessionPayloadSchema.safeParse({ sourceUrl: 'https://www.balancestudio.tv' });
  expect(result.success).toBe(true);
});

test('chat response payload accepts a single message', () => {
  const result = chatResponsePayloadSchema.safeParse({ message: 'hello' });
  expect(result.success).toBe(true);
});

test('chat response payload accepts a multi-bubble messages array', () => {
  const result = chatResponsePayloadSchema.safeParse({ messages: ['one', 'two', 'three'] });
  expect(result.success).toBe(true);
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

test('chat request payload rejects when messages is empty', () => {
  const result = chatRequestPayloadSchema.safeParse({ messages: [] });
  expect(result.success).toBe(false);
});
