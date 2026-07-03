const ALLOWED_KEYS = [
  'service',
  'projectScope',
  'timelineBand',
  'budgetBand',
  'contactName',
  'contactCompany',
  'contactEmail'
] as const;

const SERVICES = [
  '',
  'production',
  'post-production',
  'event-experience-content',
  'media-asset-adaptation',
  'design-direction',
  'generative-ai',
  'not-sure-yet'
];

const TIMELINES = ['', 'asap', '1-2-months', '3-plus-months', 'flexible'];
const BUDGETS = ['', 'under-20k', '20k-50k', '50k-150k', '150k-plus', 'not-sure-yet'];
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const MAX_TEXT_LENGTH = 200;

export function sanitizeDraftUpdates(input: Record<string, unknown> | null | undefined) {
  const result: Record<string, string> = {};
  if (!input || typeof input !== 'object') return result;
  for (const key of ALLOWED_KEYS) {
    const value = input[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) {
      result[key] = '';
      continue;
    }
    if (key === 'service' && !SERVICES.includes(trimmed)) {
      result[key] = '';
      continue;
    }
    if (key === 'timelineBand' && !TIMELINES.includes(trimmed)) {
      result[key] = '';
      continue;
    }
    if (key === 'budgetBand' && !BUDGETS.includes(trimmed)) {
      result[key] = '';
      continue;
    }
    if (key === 'contactEmail' && !EMAIL_REGEX.test(trimmed)) {
      result[key] = '';
      continue;
    }
    result[key] = trimmed.slice(0, MAX_TEXT_LENGTH);
  }
  return result;
}
