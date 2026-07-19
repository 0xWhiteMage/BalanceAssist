import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { listAllWorks } from '@/lib/conversation/works-search';
import type { LeadDraft } from '@/lib/onboarding/types';
import { MAX_PROJECT_SCOPE_CHARACTERS } from '@/lib/api/contracts';

const TEXT_FIELD_DESCRIPTION =
  "Include this key only when the user changed the field. Preserve explicit non-answers such as 'Not sure yet', 'Skip', and 'Prefer not to share'.";

export const recordBriefUpdatesSchema = z
  .object({
    service: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    projectType: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    projectScope: z.string().max(MAX_PROJECT_SCOPE_CHARACTERS).optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    projectObjective: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    audience: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    intendedOutputs: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    referencesStatus: z.enum(['', 'added', 'skipped']).optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    scopePolished: z.string().optional().catch(undefined).describe(`${TEXT_FIELD_DESCRIPTION} When projectScope is present, provide a concise one-sentence summary using only explicitly stated project details.`),
    timelineBand: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    budgetBand: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    contactName: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    contactCompany: z.string().optional().catch(undefined).describe(TEXT_FIELD_DESCRIPTION),
    contactEmail: z
      .union([z.literal(''), z.string().email()])
      .optional()
      .catch(undefined)
      .describe('Include only when the user provided or changed a valid email address.')
  })
  .strip();

// Field-specific normalization and shorter generated-field caps remain in sanitizeDraftUpdates.

const generated = zodToJsonSchema(recordBriefUpdatesSchema, {
  target: 'jsonSchema7',
  $refStrategy: 'none'
}) as Record<string, unknown>;

export const recordBriefUpdatesJsonSchema = generated;

const SHARE_WORK_CATEGORY_DESCRIPTION =
  "Why you are sharing this work. 'reference' = inspiration/look, 'mood' = aesthetic reference, 'pitch' = showcasing for the user's brief.";

export const shareWorkSchema = z
  .object({
    slugs: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(5)
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
    if (cleaned.length >= 5) break;
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

  const nextScope = typeof cleaned.projectScope === 'string' ? cleaned.projectScope.trim() : '';
  if (nextScope && nextScope !== priorDraft.projectScope) {
    if (priorDraft.projectScope?.trim()) {
      cleaned.projectScope = priorDraft.projectScope;
    } else {
      cleaned.projectScope = userMessage.trim();
    }
  }

  if (cleaned.referencesStatus === 'added' && priorDraft.referencesStatus !== 'added') {
    cleaned.referencesStatus = '';
  } else if (
    cleaned.referencesStatus === 'skipped' &&
    priorDraft.referencesStatus !== 'skipped' &&
    !/^skip$/i.test(userMessage.trim())
  ) {
    cleaned.referencesStatus = '';
  }

  for (const field of ['projectObjective', 'audience', 'intendedOutputs'] as const) {
    const nextValue = typeof cleaned[field] === 'string' ? cleaned[field].trim() : '';
    const priorValue = priorDraft[field]?.trim() ?? '';
    if (priorValue && nextValue && nextValue !== priorValue && !textContains(userMessage, nextValue)) {
      const additiveOutputs = field === 'intendedOutputs' && nextValue.toLowerCase().includes(priorValue.toLowerCase()) && (() => {
        const priorTokens = new Set(priorValue.toLowerCase().match(/[a-z0-9]+/g) ?? []);
        const addedTokens = (nextValue.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 2 && !priorTokens.has(token));
        const userTokens = new Set(userMessage.toLowerCase().match(/[a-z0-9]+/g) ?? []);
        return addedTokens.length > 0 && addedTokens.every((token) => userTokens.has(token));
      })();
      if (!additiveOutputs) cleaned[field] = priorValue;
    }
  }

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
