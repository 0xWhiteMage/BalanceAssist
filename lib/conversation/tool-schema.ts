import { z } from 'zod';

export const referenceLinkSchema = z.object({
  kind: z.enum(['youtube', 'vimeo', 'figma', 'loom', 'gdrive', 'other']),
  url: z.string().url()
});

export const referenceFileSchema = z.object({
  kind: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1).optional(),
  telegramFileId: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative(),
  mime: z.string().min(1)
});

export const recordBriefUpdatesSchema = z.object({
  service: z.string().default(''),
  projectType: z.string().default(''),
  projectScope: z.string().default(''),
  scopePolished: z.string().default(''),
  timelineBand: z.string().default(''),
  budgetBand: z.string().default(''),
  contactName: z.string().default(''),
  contactCompany: z.string().default(''),
  contactEmail: z.string().email().optional().or(z.literal('')),
  referenceLinks: z.array(referenceLinkSchema).default([]),
  referenceFiles: z.array(referenceFileSchema).default([])
}).strict();

export const recordBriefUpdatesJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    service: { type: 'string' },
    projectType: { type: 'string' },
    projectScope: { type: 'string' },
    scopePolished: { type: 'string' },
    timelineBand: { type: 'string' },
    budgetBand: { type: 'string' },
    contactName: { type: 'string' },
    contactCompany: { type: 'string' },
    contactEmail: { type: 'string' },
    referenceLinks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['youtube', 'vimeo', 'figma', 'loom', 'gdrive', 'other'] },
          url: { type: 'string' }
        },
        required: ['kind', 'url']
      }
    },
    referenceFiles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          name: { type: 'string' },
          url: { type: 'string' },
          telegramFileId: { type: 'string' },
          sizeBytes: { type: 'integer' },
          mime: { type: 'string' }
        },
        required: ['kind', 'name', 'sizeBytes', 'mime']
      }
    }
  }
};
