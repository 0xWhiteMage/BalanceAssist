import { describe, it, expect } from 'vitest';
import { generateIdempotencyKey } from '@/lib/handoff/outbox';

describe('handoff/outbox', () => {
  describe('generateIdempotencyKey', () => {
    it('generates a deterministic key for same inputs', () => {
      const a = generateIdempotencyKey('session-1', 'approval', 'summary text');
      const b = generateIdempotencyKey('session-1', 'approval', 'summary text');
      expect(a).toBe(b);
    });

    it('generates different keys for different sessions', () => {
      const a = generateIdempotencyKey('session-1', 'approval', 'same');
      const b = generateIdempotencyKey('session-2', 'approval', 'same');
      expect(a).not.toBe(b);
    });

    it('generates different keys for different types', () => {
      const a = generateIdempotencyKey('session-1', 'approval', 'same');
      const b = generateIdempotencyKey('session-1', 'relay', 'same');
      expect(a).not.toBe(b);
    });

    it('starts with ho_ prefix', () => {
      const key = generateIdempotencyKey('s', 't', 'd');
      expect(key).toMatch(/^ho_/);
    });
  });
});
