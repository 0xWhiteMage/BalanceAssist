import { z } from 'zod';

export const finalizeLeadResponseSchema = z.discriminatedUnion('persisted', [
  z.object({
    ok: z.literal(true),
    sessionId: z.string(),
    qualificationStatus: z.string().nullable(),
    persisted: z.literal(true),
    queued: z.boolean(),
    delivered: z.boolean(),
    retryable: z.boolean(),
    handoffId: z.string().optional(),
    score: z.number().nullable().optional(),
    recommendedNextStep: z.string().nullable().optional(),
    crmRecordId: z.string().optional(),
    crmQueued: z.boolean(),
    crmRevision: z.number().int().nonnegative().optional(),
    approvedDraftVersion: z.number().int().nonnegative(),
    approvalInputHash: z.string().min(1),
    approvedReferenceSetHash: z.string().min(1)
  }).strict(),
  z.object({
    ok: z.literal(true),
    sessionId: z.string(),
    persisted: z.literal(false),
    reason: z.string()
  }).strict()
]);

export type FinalizeLeadResponse = z.infer<typeof finalizeLeadResponseSchema>;
