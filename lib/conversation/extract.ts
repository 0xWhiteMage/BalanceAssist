import { serviceOptions } from '@/lib/onboarding/service-options';
import type { LeadDraft, ServiceOptionId } from '@/lib/onboarding/types';
import type { ConversationStepId } from '@/lib/conversation/types';

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const strictEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PROJECT_SIGNAL_PATTERN =
  /\b(video|film|animation|graphic|design|brand|campaign|ad|advert|promo|content|photo|3d|2d|edit|footage|shoot|launch|event|exhibit|production|project|script|storyboard|animatic)\b/i;

const OUT_OF_SCOPE_TRIGGER_PATTERN =
  /^(draft|homework|essay|writing|math|recipe|cooking|counsel|cry|therapy|emotional|advice|help|support|cancel|stop|bye|goodbye|apply|hire|recruit|subscribe|login|sign in|hi|hello|hey|thanks?|thank you)\b/i;

function hasProjectSignal(text: string): boolean {
  return PROJECT_SIGNAL_PATTERN.test(text);
}

type DraftUpdates = Partial<LeadDraft>;

function shouldOverwriteExistingValue(text: string) {
  return /\b(update|change|correct|actually|instead|replace|revise)\b/i.test(text);
}

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

function detectProjectType(text: string): string | null {
  const normalized = normalize(text);

  if (/2d animation|2d animated|2d video/.test(normalized)) return '2D animation';
  if (/3d animation|3d video/.test(normalized)) return '3D animation';
  if (/motion graphics|motion graphic/.test(normalized)) return 'Motion graphics';
  if (/brand film/.test(normalized)) return 'Brand film';
  if (/explainer/.test(normalized)) return 'Explainer video';
  if (/social/.test(normalized) && /video|animation/.test(normalized)) return 'Social video';
  if (/video/.test(normalized)) return 'Video';
  if (/animation/.test(normalized)) return 'Animation';

  return null;
}

const NAME_BLACKLIST = new Set([
  'looking',
  'here',
  'ready',
  'sorry',
  'interested',
  'asking',
  'curious',
  'from',
  'with',
  'working',
  'inquire',
  'going',
  'wondering',
  'thinking'
]);

function isLikelyName(s: string): boolean {
  const words = s
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  for (const word of words) {
    if (NAME_BLACKLIST.has(word)) return false;
  }
  return true;
}

function detectName(text: string): string | null {
  const nameMatch = text.match(/(?:i am|i'm|my name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i);
  if (nameMatch?.[1]) {
    const captured = nameMatch[1].trim();
    const titled = captured
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
    if (isLikelyName(titled)) {
      return titled;
    }
    return null;
  }

  const trimmed = text.trim();
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(trimmed) && isLikelyName(trimmed)) {
    return trimmed;
  }

  return null;
}

function detectCompany(text: string): string | null {
  const patterns = [
    /(?:from|at|for|with)\s+([A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,3})\b/,
    /\b([A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,2})\s+(?:Inc|Corp|Ltd|LLC|Pvt|Pte|Co|Studio|Studios|Group|Agency|Lab)\b/,
    /(?:i\s+(?:work|am)\s+(?:at|with|for))\s+([A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,3})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const cleaned = match[1].trim();
      if (cleaned.length >= 2 && !/^(I|My|Me|You|We|They|The|This|That|It|At|From|With|And|Or|But)$/i.test(cleaned)) {
        return cleaned;
      }
    }
  }

  return null;
}

export function extractDraftUpdatesFromText(text: string, currentDraft: LeadDraft, currentStep: ConversationStepId): DraftUpdates {
  const updates: DraftUpdates = {};
  const overwrite = shouldOverwriteExistingValue(text);

  const detectedService = detectService(text);
  const detectedProjectType = detectProjectType(text);
  const detectedEmail = text.match(emailPattern)?.[0] ?? null;
  const detectedName = detectName(text);
  const detectedCompany = detectCompany(text);

  if (detectedService && (!currentDraft.service || overwrite)) updates.service = detectedService;
  if (detectedProjectType && (!(currentDraft.projectType ?? '') || overwrite)) updates.projectType = detectedProjectType;
  if (detectedEmail && (!currentDraft.contactEmail || overwrite)) updates.contactEmail = detectedEmail;
  if (detectedName && (!currentDraft.contactName || overwrite)) updates.contactName = detectedName;

  const currentCompany = (currentDraft as Record<string, unknown>).contactCompany;
  if (detectedCompany && (!currentCompany || overwrite)) {
    (updates as Record<string, unknown>).contactCompany = detectedCompany;
  }

  const trimmedText = text.trim();
  const looksLikeScopeDescription =
    trimmedText.length > 24 &&
    !OUT_OF_SCOPE_TRIGGER_PATTERN.test(trimmedText) &&
    hasProjectSignal(trimmedText);

  if (
    (currentStep === 'intro' || currentStep === 'scope' || currentStep === 'service') &&
    looksLikeScopeDescription &&
    (!currentDraft.projectScope || overwrite)
  ) {
    updates.projectScope = trimmedText;
  }

  if (currentStep === 'contact-name' && !updates.contactName && (!currentDraft.contactName || overwrite)) {
    const explicit = text.match(/(?:my name is|i'm called|this is|name's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i);
    if (explicit?.[1]) updates.contactName = explicit[1].trim();
  }

  if (currentStep === 'contact-email' && !updates.contactEmail && (!currentDraft.contactEmail || overwrite)) {
    const trimmed = text.trim();
    if (strictEmailPattern.test(trimmed)) {
      updates.contactEmail = trimmed;
    }
  }

  if (currentStep === 'consent' && currentDraft.consentToShare === undefined) {
    const normalized = text.trim().toLowerCase();
    if (/^(yes|yeah|yep|sure|ok|okay|go ahead|sounds good|absolutely|definitely|please|y)$/i.test(normalized)) {
      updates.consentToShare = true;
    } else if (/^(no|nah|nope|not now|skip|pass|later|not yet)$/i.test(normalized)) {
      updates.consentToShare = false;
    }
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
  if (!draft.consentToShare) return 'consent';
  return 'qualification';
}

export function getDraftSummaryLines(draft: LeadDraft): string[] {
  const lines: string[] = [];

  if (draft.service) {
    lines.push(`Service: ${draft.service.replace(/-/g, ' ')}`);
  }
  if (draft.projectType) {
    lines.push(`Project type: ${draft.projectType}`);
  }
  if (draft.projectScope) {
    lines.push(`Project scope: ${draft.projectScope}`);
  }
  if (draft.timelineBand) {
    lines.push(`Timeline: ${draft.timelineBand.replace(/-/g, ' ')}`);
  }
  if (draft.budgetBand) {
    lines.push(`Budget: ${draft.budgetBand.replace(/-/g, ' ')}`);
  }
  if (draft.contactName) {
    lines.push(`Contact: ${draft.contactName}`);
  }
  if (draft.contactCompany) {
    lines.push(`Company: ${draft.contactCompany}`);
  }
  if (draft.contactEmail) {
    lines.push(`Email: ${draft.contactEmail}`);
  }

  return lines;
}
