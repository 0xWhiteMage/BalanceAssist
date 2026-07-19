import { z } from 'zod';
import { conversationSteps } from '@/lib/conversation/flow';
import type { ConversationStepId } from '@/lib/conversation/types';

export const MAX_CHAT_BODY_BYTES = 50_000;
export const MAX_CHAT_MESSAGES = 20;
export const MAX_PROJECT_SCOPE_CHARACTERS = 4_000;
export const MAX_CHAT_MESSAGE_CHARACTERS = MAX_PROJECT_SCOPE_CHARACTERS;
export const MAX_CHAT_TOTAL_CHARACTERS = 40_000;
export const MAX_CHAT_CONTEXT_STEP_CHARACTERS = 256;
export const MAX_CHAT_CONTEXT_DRAFT_CHARACTERS = 16_000;
export const MAX_CHAT_CONTEXT_SESSION_ID_CHARACTERS = 128;
export const MAX_CHAT_CAPTURED_FIELDS = 20;
export const MAX_CHAT_CAPTURED_FIELD_CHARACTERS = 64;
export const MAX_SESSION_BODY_BYTES = 16_384;
export const MAX_EVENT_BODY_BYTES = 2_048;

export const createSessionPayloadSchema = z.object({
  sourceUrl: z.string().url(),
  referrer: z.string().url().optional(),
  utm: z.record(z.string()).optional(),
  consentVersion: z.string().min(1),
  consentedAt: z.string().datetime()
});

export const trustFeedbackDimensionSchema = z.enum(['clarity_helpfulness', 'comfort', 'reuse']);
export const trustFeedbackResponseSchema = z.enum(['yes', 'not_quite']);
export const trustFeedbackPropertiesSchema = z.object({
  dimension: trustFeedbackDimensionSchema,
  response: trustFeedbackResponseSchema
}).strict();

const conversationStepSchema = z.enum(
  Object.keys(conversationSteps) as [ConversationStepId, ...ConversationStepId[]]
);
const sessionIdSchema = z.string().min(1).max(128);
const noPropertyEventNames = [
  'widget_closed', 'human_handoff', 'memory_inspected',
  'memory_reset_requested', 'memory_correction_requested'
] as const;
const noPropertyEventSchema = z.object({
  sessionId: sessionIdSchema,
  eventName: z.enum(noPropertyEventNames)
}).strict();

export const eventPayloadSchema = z.discriminatedUnion('eventName', [
  noPropertyEventSchema,
  z.object({
    sessionId: sessionIdSchema,
    eventName: z.literal('step_advanced'),
    properties: z.object({ from: conversationStepSchema, to: conversationStepSchema }).strict()
  }).strict(),
  z.object({
    sessionId: sessionIdSchema,
    eventName: z.literal('trust_feedback'),
    properties: trustFeedbackPropertiesSchema
  }).strict()
]);

export type TrustFeedbackDimension = z.infer<typeof trustFeedbackDimensionSchema>;
export type TrustFeedbackResponse = z.infer<typeof trustFeedbackResponseSchema>;
export type EventPayload = z.infer<typeof eventPayloadSchema>;

export const finalizeLeadPayloadSchema = z.object({
  sessionId: z.string().min(1)
}).strict();

const chatReplyFields = {
  message: z.string().min(1).optional(),
  messages: z.array(z.string().min(1)).min(1).optional()
};
export const chatSharedWorkEntrySchema = z.object({
    title: z.string(), url: z.string(), description: z.string().optional(), image_url: z.string().optional(),
    category: z.enum(['reference', 'mood', 'pitch']).optional(), slug: z.string(),
    clients: z.string().optional(), year: z.number().nullable().optional()
  }).strict();
const chatSharedWorkSchema = z.object({
  entries: z.array(chatSharedWorkEntrySchema)
}).strict();
const canonicalChatFields = {
  canonicalDraft: z.record(z.string()),
  canonicalProvenance: z.record(z.enum(['user-stated', 'inferred', 'confirmed', 'cleared'])).optional(),
  draftVersion: z.number().int().nonnegative(),
  currentStage: z.enum(['project', 'audience', 'planning', 'references-contact']),
  stageRecaps: z.array(z.string()),
  briefReady: z.boolean()
};

export const chatResponsePayloadSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('draft_persisted'), ...chatReplyFields, ...canonicalChatFields,
    draftUpdates: z.record(z.string()).optional(), reviewPrompt: z.string().nullable().optional(),
    missingFields: z.array(z.string()).optional(), sharedWork: chatSharedWorkSchema.optional(), truncated: z.boolean().optional()
  }).strict(),
  z.object({ outcome: z.literal('draft_conflict'), ...chatReplyFields, ...canonicalChatFields }).strict(),
  z.object({ outcome: z.literal('non_persistence'), ...chatReplyFields, sharedWork: chatSharedWorkSchema.optional() }).strict(),
  z.object({ outcome: z.literal('confidential_diversion'), ...chatReplyFields }).strict(),
  z.object({ outcome: z.literal('draft_save_failed'), ...chatReplyFields }).strict(),
  z.object({
    outcome: z.literal('provider_unavailable'),
    error: z.literal('Chat service unavailable'),
    detail: z.literal('chat_provider_unavailable')
  }).strict()
]).superRefine((value, context) => {
  if (value.outcome !== 'provider_unavailable' && !value.message && !value.messages) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Either message or messages must be provided' });
  }
});

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
      capturedFields: z.array(z.string().max(MAX_CHAT_CAPTURED_FIELD_CHARACTERS)).max(MAX_CHAT_CAPTURED_FIELDS).optional(),
      workSearchPending: z.boolean().optional(),
      sharedWorkSlugs: z.array(z.string().max(120)).max(20).optional()
    })
    .optional()
  })
  .superRefine((value, context) => {
    const currentMessage = value.messages[value.messages.length - 1];
    if (!currentMessage || currentMessage.role !== 'user' || currentMessage.content.trim().length === 0) {
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

export type ChatResponsePayload = z.infer<typeof chatResponsePayloadSchema>;
export type ChatSharedWorkEntry = z.infer<typeof chatSharedWorkEntrySchema>;
