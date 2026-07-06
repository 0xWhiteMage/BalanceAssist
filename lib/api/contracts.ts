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
      timelineBand: z.string().optional(),
      budgetBand: z.string().optional(),
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
      contactCompany: z.string().optional()
    })
    .optional()
});
