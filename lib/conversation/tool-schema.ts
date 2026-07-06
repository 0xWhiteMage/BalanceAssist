import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const TEXT_FIELD_DESCRIPTION =
  "Use '' (empty string) when the field is unknown; do NOT omit the key.";

export const recordBriefUpdatesSchema = z
  .object({
    service: z.string().default('').describe(TEXT_FIELD_DESCRIPTION),
    projectType: z.string().default('').describe(TEXT_FIELD_DESCRIPTION),
    projectScope: z.string().default('').describe(TEXT_FIELD_DESCRIPTION),
    scopePolished: z.string().default('').describe(TEXT_FIELD_DESCRIPTION),
    timelineBand: z.string().default('').describe(TEXT_FIELD_DESCRIPTION),
    budgetBand: z.string().default('').describe(TEXT_FIELD_DESCRIPTION),
    contactName: z.string().default('').describe(TEXT_FIELD_DESCRIPTION),
    contactCompany: z.string().default('').describe(TEXT_FIELD_DESCRIPTION),
    contactEmail: z
      .union([z.literal(''), z.string().email()])
      .optional()
      .describe("Either '' or a valid email address; do NOT omit the key.")
  })
  .strict();

// Length caps are enforced by sanitizeDraftUpdates (200 chars); this schema trusts that layer.

const generated = zodToJsonSchema(recordBriefUpdatesSchema, {
  target: 'jsonSchema7',
  $refStrategy: 'none'
}) as Record<string, unknown>;

// The LLM must always send every key (using '' as the unknown sentinel), even though
// Zod treats defaulted fields as optional. List every property in `required` so the
// tool-call contract enforces completeness regardless of JSON Schema's default semantics.
{
  const properties = (generated.properties ?? {}) as Record<string, unknown>;
  generated.required = Object.keys(properties).sort();
}

export const recordBriefUpdatesJsonSchema = generated;
