import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { listAllWorks } from '@/lib/conversation/works-search';
import type { LeadDraft } from '@/lib/onboarding/types';

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
      .describe("Either '' or a valid email address; do NOT omit the key."),
    consentToShare: z.boolean().optional()
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

const SHARE_WORK_CATEGORY_DESCRIPTION =
  "Why you are sharing this work. 'reference' = inspiration/look, 'mood' = aesthetic reference, 'pitch' = showcasing for the user's brief.";

export const shareWorkSchema = z
  .object({
    slugs: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(8)
      .describe('Slugs of the works to share, drawn from docs/balance-works.json (1-8 entries).'),
    category: z
      .enum(['reference', 'mood', 'pitch'])
      .default('reference')
      .describe(SHARE_WORK_CATEGORY_DESCRIPTION)
  })
  .strict();

export const ALLOWED_WORK_KEYS = ['slugs', 'category'] as const;

let VALID_SLUGS: Set<string> | null = null;

function getValidSlugs(): Set<string> {
  if (VALID_SLUGS) return VALID_SLUGS;
  const set = new Set<string>();
  for (const w of listAllWorks()) {
    set.add(w.slug);
  }
  VALID_SLUGS = set;
  return set;
}

export function sanitizeShareWork(
  input: Record<string, unknown> | null | undefined
): { slugs: string[]; category: 'reference' | 'mood' | 'pitch' } {
  const fallback = { slugs: [] as string[], category: 'reference' as const };
  if (!input || typeof input !== 'object') return fallback;

  const rawSlugs = Array.isArray(input.slugs) ? input.slugs : [];
  const valid = getValidSlugs();
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const candidate of rawSlugs) {
    if (typeof candidate !== 'string') continue;
    const slug = candidate.trim();
    if (!slug || slug.length > 80) continue;
    if (!valid.has(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    cleaned.push(slug);
    if (cleaned.length >= 8) break;
  }

  if (cleaned.length === 0) return fallback;

  const rawCategory = input.category;
  const category: 'reference' | 'mood' | 'pitch' =
    rawCategory === 'mood' || rawCategory === 'pitch' ? rawCategory : 'reference';

  return { slugs: cleaned, category };
}

const shareWorkGenerated = zodToJsonSchema(shareWorkSchema, {
  target: 'jsonSchema7',
  $refStrategy: 'none'
}) as Record<string, unknown>;

{
  const properties = (shareWorkGenerated.properties ?? {}) as Record<string, unknown>;
  shareWorkGenerated.required = Object.keys(properties).sort();
}

export const shareWorkJsonSchema = shareWorkGenerated;

function textContains(text: string, value: string): boolean {
  if (!value) return false;
  return text.toLowerCase().includes(value.toLowerCase());
}

export function guardAgainstFabricatedBriefFields(
  toolArgs: Record<string, unknown>,
  priorDraft: LeadDraft,
  userMessage: string
): Record<string, unknown> {
  if (!toolArgs || typeof toolArgs !== 'object') return toolArgs;
  const cleaned: Record<string, unknown> = { ...toolArgs };

  const priorEmail = priorDraft.contactEmail ?? '';
  const priorName = priorDraft.contactName ?? '';

  if (typeof cleaned.contactEmail === 'string' && cleaned.contactEmail.trim()) {
    const email = cleaned.contactEmail.trim();
    if (email !== priorEmail && !textContains(userMessage, email)) {
      cleaned.contactEmail = '';
    }
  }

  if (typeof cleaned.contactName === 'string' && cleaned.contactName.trim()) {
    const name = cleaned.contactName.trim();
    if (name !== priorName && !textContains(userMessage, name)) {
      const explicitName = userMessage.match(
        /(?:my name is|i'm called|this is|name's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i
      );
      if (!explicitName || explicitName[1].trim() !== name) {
        cleaned.contactName = '';
      }
    }
  }

  if (typeof cleaned.contactCompany === 'string' && cleaned.contactCompany.trim()) {
    const company = cleaned.contactCompany.trim();
    const priorCompany = priorDraft.contactCompany ?? '';
    if (company !== priorCompany && !textContains(userMessage, company)) {
      cleaned.contactCompany = '';
    }
  }

  return cleaned;
}