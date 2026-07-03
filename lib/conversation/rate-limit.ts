const WINDOW_MS = 60 * 60 * 1000;
const MAX_CALLS_PER_WINDOW = 20;
const GC_INTERVAL_CALLS = 100;

const buckets = new Map<string, number[]>();
let callCount = 0;

export function checkRateLimit(sessionId: string): {
  allowed: boolean;
  remaining: number;
  max: number;
} {
  callCount += 1;
  if (callCount % GC_INTERVAL_CALLS === 0) {
    gcRateLimits();
  }

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

export function gcRateLimits(): number {
  const cutoff = Date.now() - WINDOW_MS;
  let removed = 0;
  for (const [key, timestamps] of buckets) {
    const recent = timestamps.filter((timestamp) => timestamp > cutoff);
    if (recent.length === 0) {
      buckets.delete(key);
      removed += 1;
    } else if (recent.length !== timestamps.length) {
      buckets.set(key, recent);
    }
  }
  return removed;
}
