import { describe, it, expect } from 'vitest';
import {
  generateCapability,
  hashCapability,
  verifyCapability,
  extractSessionIdFromCapability,
  getCapabilityTtlMs
} from '@/lib/security/session-capability';

describe('session-capability', () => {
  describe('generateCapability', () => {
    it('returns a capability with sessionId prefix', () => {
      const result = generateCapability('test-session-id');
      expect(result.sessionId).toBe('test-session-id');
      expect(result.capability).toContain('test-session-id.');
      expect(result.expiresAt).toBeTruthy();
    });

    it('generates unique capabilities', () => {
      const a = generateCapability('same-id');
      const b = generateCapability('same-id');
      expect(a.capability).not.toBe(b.capability);
    });
  });

  describe('hashCapability', () => {
    it('returns a hex hash', () => {
      const hash = hashCapability('test.capability');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic', () => {
      const a = hashCapability('same-input');
      const b = hashCapability('same-input');
      expect(a).toBe(b);
    });
  });

  describe('verifyCapability', () => {
    it('returns true for valid capability', () => {
      const { capability, expiresAt } = generateCapability('session-1');
      const storedHash = hashCapability(capability);
      expect(verifyCapability(capability, storedHash, expiresAt)).toBe(true);
    });

    it('returns false for wrong capability', () => {
      const { capability, expiresAt } = generateCapability('session-1');
      const storedHash = hashCapability(capability);
      const wrong = capability.slice(0, -4) + 'XXXX';
      expect(verifyCapability(wrong, storedHash, expiresAt)).toBe(false);
    });

    it('returns false for expired capability', () => {
      const { capability } = generateCapability('session-1');
      const storedHash = hashCapability(capability);
      const pastDate = new Date(Date.now() - 1000).toISOString();
      expect(verifyCapability(capability, storedHash, pastDate)).toBe(false);
    });
  });

  describe('extractSessionIdFromCapability', () => {
    it('extracts session ID before the dot', () => {
      expect(extractSessionIdFromCapability('abc-123.some-secret')).toBe('abc-123');
    });

    it('returns null when no dot', () => {
      expect(extractSessionIdFromCapability('nosecret')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractSessionIdFromCapability('')).toBeNull();
    });
  });

  describe('getCapabilityTtlMs', () => {
    it('returns 24 hours in milliseconds', () => {
      expect(getCapabilityTtlMs()).toBe(24 * 60 * 60 * 1000);
    });
  });
});
