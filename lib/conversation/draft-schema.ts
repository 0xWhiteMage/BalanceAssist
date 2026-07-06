const ALLOWED_KEYS = [
  'service',
  'projectType',
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

function normalizeService(value: string) {
  if (SERVICES.includes(value)) {
    return value;
  }

  const normalized = value.toLowerCase();
  if (/animation|video|film|motion|brand film|social/.test(normalized)) return 'production';
  if (/edit|editing|color|sound|finish/.test(normalized)) return 'post-production';
  if (/event|activation|experience/.test(normalized)) return 'event-experience-content';
  if (/adaptation|resize|resizing|asset/.test(normalized)) return 'media-asset-adaptation';
  if (/design|art direction|visual system/.test(normalized)) return 'design-direction';
  if (/generative ai|gen ai|ai concept/.test(normalized)) return 'generative-ai';
  return '';
}

function normalizeTimeline(value: string) {
  if (TIMELINES.includes(value)) {
    return value;
  }

  const normalized = value.toLowerCase();
  if (/1\s*week|one week|within a week|within 1 week|urgent|asap|immediate/.test(normalized)) return 'asap';
  if (/1\s*(to|-)?\s*2\s*months|2 months|one month|next month/.test(normalized)) return '1-2-months';
  if (/3\+?\s*months|three months|quarter|later this year/.test(normalized)) return '3-plus-months';
  if (/flexible|open ended|open-ended/.test(normalized)) return 'flexible';
  return '';
}

function normalizeBudget(value: string) {
  if (BUDGETS.includes(value)) {
    return value;
  }

  const normalized = value.toLowerCase();
  if (normalized.includes('not sure')) return 'not-sure-yet';
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(k|m|sgd|usd)?/i);
  if (!match) return '';
  let amount = Number(match[1].replace(',', '.'));
  const unit = match[2]?.toLowerCase() ?? '';
  if (!Number.isFinite(amount)) return '';
  if (unit === 'k') amount *= 1000;
  if (unit === 'm') amount *= 1000000;
  if (amount < 20000) return 'under-20k';
  if (amount < 50000) return '20k-50k';
  if (amount < 150000) return '50k-150k';
  return '150k-plus';
}

function normalizeName(value: string) {
  return value
    .replace(/\b(from|at|with)\b.*$/i, '')
    .trim();
}

function normalizeCompany(value: string) {
  return value.replace(/^(from|at|with)\s+/i, '').trim();
}

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
    if (key === 'service') {
      result[key] = normalizeService(trimmed);
      continue;
    }
    if (key === 'timelineBand') {
      result[key] = normalizeTimeline(trimmed);
      continue;
    }
    if (key === 'budgetBand') {
      result[key] = normalizeBudget(trimmed);
      continue;
    }
    if (key === 'contactEmail' && !EMAIL_REGEX.test(trimmed)) {
      result[key] = '';
      continue;
    }
    if (key === 'contactName') {
      result[key] = normalizeName(trimmed).slice(0, MAX_TEXT_LENGTH);
      continue;
    }
    if (key === 'contactCompany') {
      result[key] = normalizeCompany(trimmed).slice(0, MAX_TEXT_LENGTH);
      continue;
    }
    result[key] = trimmed.slice(0, MAX_TEXT_LENGTH);
  }
  return result;
}
