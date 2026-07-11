const ALLOWED_KEYS = [
  'service',
  'projectType',
  'projectScope',
  'scopePolished',
  'timelineBand',
  'budgetBand',
  'contactName',
  'contactCompany',
  'contactEmail',
  'consentToShare'
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

function normalizeName(value: string) {
  return value
    .replace(/\b(from|at|with)\b.*$/i, '')
    .trim();
}

function normalizeCompany(value: string) {
  return value.replace(/^(from|at|with)\s+/i, '').trim();
}

export function sanitizeDraftUpdates(input: Record<string, unknown> | null | undefined) {
  const result: Record<string, string | boolean> = {};
  if (!input || typeof input !== 'object') return result;
  for (const key of ALLOWED_KEYS) {
    const value = input[key];
    if (key === 'consentToShare') {
      if (value === true || value === 'true') {
        result[key] = true;
      }
      continue;
    }
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) {
      // Empty string means the LLM did not provide a value for this field.
      // Do NOT include it in the result so the prior draft value is preserved.
      continue;
    }
    if (key === 'service') {
      result[key] = normalizeService(trimmed);
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
