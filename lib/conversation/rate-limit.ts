const WINDOW_MS = 60 * 60 * 1000;
const MAX_CALLS_PER_WINDOW = 20;

const buckets = new Map<string, number[]>();

export function checkRateLimit(sessionId: string): {
  allowed: boolean;
  remaining: number;
  max: number;
} {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const existing = buckets.get(sessionId) ?? [];
  const recent = existing.filter((timestamp) => timestamp > cutoff);

  if (recent.length >= MAX_CALLS_PER_WINDOW) {
    buckets.set(sessionId, recent);
    return { allowed: false, remaining: 0, max: MAX_CALLS_PER_WINDOW };
  }

  recent.push(now);
  buckets.set(sessionId, recent);
  return {
    allowed: true,
    remaining: MAX_CALLS_PER_WINDOW - recent.length,
    max: MAX_CALLS_PER_WINDOW
  };
}

export function resetRateLimit(sessionId: string) {
  buckets.delete(sessionId);
}
