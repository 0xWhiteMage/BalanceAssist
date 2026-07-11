import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type SessionCapability = {
  sessionId: string;
  capability: string;
  expiresAt: string;
};

export function generateCapability(sessionId: string): SessionCapability {
  const secret = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + CAPABILITY_TTL_MS);

  return {
    sessionId,
    capability: `${sessionId}.${secret}`,
    expiresAt: expiresAt.toISOString()
  };
}

export function hashCapability(capability: string): string {
  return createHash('sha256').update(capability).digest('hex');
}

export function verifyCapability(
  provided: string,
  storedHash: string,
  expiresAt: string
): boolean {
  if (new Date(expiresAt) < new Date()) return false;

  const providedHash = hashCapability(provided);
  const a = Buffer.from(providedHash);
  const b = Buffer.from(storedHash);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export function extractSessionIdFromCapability(capability: string): string | null {
  const dotIndex = capability.indexOf('.');
  if (dotIndex <= 0) return null;
  return capability.slice(0, dotIndex);
}

export function getCapabilityTtlMs(): number {
  return CAPABILITY_TTL_MS;
}
