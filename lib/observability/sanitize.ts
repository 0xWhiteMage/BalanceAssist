const REDACTED = '[redacted]';

const SENSITIVE_KEY = /(?:email|name|file|url|uri|href|endpoint|error|stack|message|capability|secret|token|password|credential|api[-_]?key|authorization|cookie|content|body|summary)/i;
const SENSITIVE_VALUE = /(?:https?:\/\/|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\+\d[\d\s().-]{7,}\d|\b\d{3}[ -]\d{3,}[ -]\d{3,}\b|\bbearer\s+\S+|\b(?:cap|token|secret)[_-][a-z0-9_-]{12,}\b)/i;

export function sanitizeObservabilityData(
  data: Record<string, unknown>,
  allowedFields?: readonly string[],
  allowedReasonCodes?: readonly string[]
): Record<string, unknown> {
  const allowed = allowedFields ? new Set(allowedFields) : undefined;
  const reasons = allowedReasonCodes ? new Set(allowedReasonCodes) : undefined;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (allowed && !allowed.has(key)) continue;
    if (key === 'reason' && reasons && (typeof value !== 'string' || !reasons.has(value))) continue;
    sanitized[key] = sanitizeValue(key, value);
  }

  return sanitized;
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key) || value instanceof Error) return REDACTED;
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE.test(value)) return REDACTED;
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(key, item));
  if (value && typeof value === 'object') return sanitizeObservabilityData(value as Record<string, unknown>);
  return value;
}
