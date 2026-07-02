import { budgetBandOptions, serviceOptions, timelineBandOptions } from '@/lib/onboarding/service-options';
import type { BudgetBandId, LeadDraft, ServiceOptionId, TimelineBandId } from '@/lib/onboarding/types';
import type { ConversationStepId } from '@/lib/conversation/types';

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const numberBudgetPattern = /(\d+(?:[.,]\d+)?)\s*(k\b|m\b|thousand\b|million\b)?/i;

type DraftUpdates = Partial<LeadDraft>;

function normalize(input: string) {
  return input.toLowerCase().trim();
}

function detectService(text: string): ServiceOptionId | null {
  const normalized = normalize(text);

  if (normalized.includes('not sure')) return 'not-sure-yet';
  if (normalized.includes('post production') || normalized.includes('post-production') || normalized.includes('editing')) {
    return 'post-production';
  }
  if (normalized.includes('event') || normalized.includes('experience content') || normalized.includes('activation')) {
    return 'event-experience-content';
  }
  if (normalized.includes('media asset') || normalized.includes('adaptation') || normalized.includes('resizing')) {
    return 'media-asset-adaptation';
  }
  if (normalized.includes('design') || normalized.includes('direction') || normalized.includes('art direction')) {
    return 'design-direction';
  }
  if (normalized.includes('generative ai') || normalized.includes('gen ai') || normalized.includes('ai visuals') || normalized.includes('ai concept')) {
    return 'generative-ai';
  }
  if (normalized.includes('production') || normalized.includes('film') || normalized.includes('video') || normalized.includes('shoot')) {
    return 'production';
  }

  for (const option of serviceOptions) {
    if (normalized.includes(option.label.toLowerCase())) {
      return option.id;
    }
  }

  return null;
}

function detectTimeline(text: string): TimelineBandId | null {
  const normalized = normalize(text);

  if (normalized.includes('asap') || normalized.includes('urgent') || normalized.includes('immediately') || normalized.includes('this week')) {
    return 'asap';
  }
  if (normalized.includes('flexible') || normalized.includes('open ended') || normalized.includes('open-ended') || normalized.includes('no fixed timeline')) {
    return 'flexible';
  }
  if (/(1\s*(to|-)?\s*2\s*months?|next month|two months?|in\s+1\s+month|in\s+2\s+months?)/i.test(text)) {
    return '1-2-months';
  }
  if (/(3\+?\s*months?|three months?|next quarter|later this year)/i.test(text)) {
    return '3-plus-months';
  }

  for (const option of timelineBandOptions) {
    if (normalized.includes(option.label.toLowerCase())) {
      return option.id;
    }
  }

  return null;
}

function detectBudget(text: string): BudgetBandId | null {
  const normalized = normalize(text);

  if (normalized.includes('not sure')) return 'not-sure-yet';
  if (normalized.includes('under 20k') || normalized.includes('below 20k') || normalized.includes('less than 20k')) return 'under-20k';
  if (normalized.includes('150k+') || normalized.includes('150k plus') || normalized.includes('over 150k') || normalized.includes('above 150k')) return '150k-plus';

  const budgetAnchorIndex = normalized.search(/budget|cost|spend|spending|around|about|roughly|approximately/);
  const budgetSlice = budgetAnchorIndex >= 0 ? text.slice(budgetAnchorIndex) : text;
  const match = budgetSlice.match(numberBudgetPattern);
  if (!match) return null;

  const hasBudgetSignal = budgetAnchorIndex >= 0 || /[$€£]|\b(?:usd|sgd|aud|cad)\b/i.test(budgetSlice) || Boolean(match[2]);
  if (!hasBudgetSignal) return null;

  const rawNumber = Number(match[1].replace(',', '.'));
  const unit = normalize(match[2] ?? '');

  if (!Number.isFinite(rawNumber)) return null;

  let value = rawNumber;
  if (unit === 'k' || unit === 'thousand') value *= 1000;
  if (unit === 'm' || unit === 'million') value *= 1000000;

  if (value < 20000) return 'under-20k';
  if (value < 50000) return '20k-50k';
  if (value < 150000) return '50k-150k';
  return '150k-plus';
}

function detectName(text: string): string | null {
  const nameMatch = text.match(/(?:i am|i'm|my name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
  if (nameMatch?.[1]) return nameMatch[1].trim();

  const trimmed = text.trim();
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function extractDraftUpdatesFromText(text: string, currentDraft: LeadDraft, currentStep: ConversationStepId): DraftUpdates {
  const updates: DraftUpdates = {};

  const detectedService = detectService(text);
  const detectedTimeline = detectTimeline(text);
  const detectedBudget = detectBudget(text);
  const detectedEmail = text.match(emailPattern)?.[0] ?? null;
  const detectedName = detectName(text);

  if (detectedService && !currentDraft.service) updates.service = detectedService;
  if (detectedTimeline && !currentDraft.timelineBand) updates.timelineBand = detectedTimeline;
  if (detectedBudget && !currentDraft.budgetBand) updates.budgetBand = detectedBudget;
  if (detectedEmail && !currentDraft.contactEmail) updates.contactEmail = detectedEmail;
  if (detectedName && !currentDraft.contactName) updates.contactName = detectedName;

  const looksLikeScopeDescription = text.trim().length > 20 || text.trim().includes(' ');

  if ((currentStep === 'intro' || currentStep === 'scope' || currentStep === 'service') && looksLikeScopeDescription && !currentDraft.projectScope) {
    updates.projectScope = text.trim();
  }

  if (currentStep === 'contact-name' && !updates.contactName && !currentDraft.contactName) {
    updates.contactName = text.trim();
  }

  if (currentStep === 'contact-email' && !updates.contactEmail && !currentDraft.contactEmail) {
    updates.contactEmail = text.trim();
  }

  return updates;
}

export function applyTextToDraft(text: string, currentDraft: LeadDraft, currentStep: ConversationStepId): LeadDraft {
  const updates = extractDraftUpdatesFromText(text, currentDraft, currentStep);
  return { ...currentDraft, ...updates };
}

export function getNextConversationStep(draft: LeadDraft): ConversationStepId {
  if (!draft.projectScope) return 'scope';
  if (!draft.service) return 'service';
  if (!draft.timelineBand) return 'timeline';
  if (!draft.budgetBand) return 'budget';
  if (!draft.contactName) return 'contact-name';
  if (!draft.contactEmail) return 'contact-email';
  return 'qualification';
}
