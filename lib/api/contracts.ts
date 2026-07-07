import { z } from 'zod';

export const createSessionPayloadSchema = z.object({
  sourceUrl: z.string().url(),
  referrer: z.string().url().optional(),
  utm: z.record(z.string()).optional()
});

export const eventPayloadSchema = z.object({
  sessionId: z.string().min(1),
  eventName: z.string().min(1),
  properties: z.record(z.unknown()).optional()
});

export const finalizeLeadPayloadSchema = z.object({
  sessionId: z.string().min(1),
  qualificationStatus: z.enum(['qualified', 'needs_review', 'misfit', 'unqualified']),
  score: z.number().int().optional(),
  recommendedNextStep: z.string().optional(),
  leadDraft: z
    .object({
      service: z.string().optional(),
      projectType: z.string().optional(),
      projectScope: z.string().optional(),
      scopePolished: z.string().optional(),
      timelineBand: z.string().optional(),
      budgetBand: z.string().optional(),
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
      contactCompany: z.string().optional(),
      referenceLinks: z.array(z.unknown()).optional(),
      referenceFiles: z.array(z.unknown()).optional()
    })
    .passthrough()
    .optional()
});

export const chatResponsePayloadSchema = z
  .object({
    message: z.string().optional(),
    messages: z.array(z.string()).min(1).optional(),
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
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().max(8000)
      })
    )
    .min(1)
    .max(20),
  context: z
    .object({
      step: z.string().optional(),
      isTeamConnected: z.boolean().optional(),
      draft: z.string().optional(),
      sessionId: z.string().optional()
    })
    .optional()
});
