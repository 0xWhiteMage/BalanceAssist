import { z } from 'zod';

export const MAX_CHAT_BODY_BYTES = 50_000;
export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_MESSAGE_CHARACTERS = 8_000;
export const MAX_CHAT_TOTAL_CHARACTERS = 40_000;
export const MAX_CHAT_CONTEXT_STEP_CHARACTERS = 256;
export const MAX_CHAT_CONTEXT_DRAFT_CHARACTERS = 16_000;
export const MAX_CHAT_CONTEXT_SESSION_ID_CHARACTERS = 128;
export const MAX_CHAT_CAPTURED_FIELDS = 20;
export const MAX_CHAT_CAPTURED_FIELD_CHARACTERS = 64;
export const MAX_SESSION_BODY_BYTES = 16_384;

export const createSessionPayloadSchema = z.object({
  sourceUrl: z.string().url(),
  referrer: z.string().url().optional(),
  utm: z.record(z.string()).optional(),
  consentVersion: z.string().min(1),
  consentedAt: z.string().datetime()
});

export const eventPayloadSchema = z.object({
  sessionId: z.string().min(1),
  eventName: z.string().min(1),
  properties: z.record(z.unknown()).optional()
});

export const finalizeLeadPayloadSchema = z.object({
  sessionId: z.string().min(1)
}).strict();

export const chatResponsePayloadSchema = z
  .object({
    message: z.string().optional(),
    messages: z.array(z.string()).min(1).optional(),
    outcome: z.literal('confidential_diversion').optional(),
    draftUpdates: z.record(z.string()).optional(),
    briefReady: z.boolean().optional(),
    reviewPrompt: z.string().nullable().optional(),
    missingFields: z.array(z.string()).optional(),
    sharedWork: z
      .object({
        entries: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            description: z.string().optional(),
            image_url: z.string().optional(),
            category: z.string().optional(),
            slug: z.string()
          })
        )
      })
      .optional(),
    error: z.string().optional(),
    detail: z.string().optional()
  })
  .refine(
    (value) =>
      Boolean(value.message && value.message.length > 0) ||
      Boolean(value.messages && value.messages.length > 0),
    { message: 'Either message or messages must be provided' }
  );

export const chatRequestPayloadSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.literal('user'),
        content: z.string().max(MAX_CHAT_MESSAGE_CHARACTERS)
      })
    )
    .min(1)
    .max(MAX_CHAT_MESSAGES),
  context: z
    .object({
      step: z.string().max(MAX_CHAT_CONTEXT_STEP_CHARACTERS).optional(),
      isTeamConnected: z.boolean().optional(),
      draft: z.string().max(MAX_CHAT_CONTEXT_DRAFT_CHARACTERS).optional(),
      sessionId: z.string().max(MAX_CHAT_CONTEXT_SESSION_ID_CHARACTERS).optional(),
      capturedFields: z.array(z.string().max(MAX_CHAT_CAPTURED_FIELD_CHARACTERS)).max(MAX_CHAT_CAPTURED_FIELDS).optional()
    })
    .optional()
  })
  .superRefine((value, context) => {
    const currentMessage = value.messages[value.messages.length - 1];
    if (!currentMessage || currentMessage.content.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages', value.messages.length - 1, 'content'],
        message: 'Current user message cannot be blank'
      });
    }

    const total = value.messages.reduce((sum, message) => sum + message.content.length, 0);
    if (total > MAX_CHAT_TOTAL_CHARACTERS) {
      context.addIssue({ code: z.ZodIssueCode.too_big, maximum: MAX_CHAT_TOTAL_CHARACTERS, type: 'string', inclusive: true, message: 'Total message content is too large' });
    }
  });
