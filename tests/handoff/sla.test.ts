import { describe, it, expect } from 'vitest';
import { getRetryDelay, shouldEscalate, getMaxRetries, type HandoffSLA } from '@/lib/handoff/sla';

describe('handoff/sla', () => {
  describe('getRetryDelay', () => {
    it('returns first delay for attempt 0', () => {
      expect(getRetryDelay(0)).toBe(1000);
    });

    it('returns second delay for attempt 1', () => {
      expect(getRetryDelay(1)).toBe(5000);
    });

    it('returns third delay for attempt 2', () => {
      expect(getRetryDelay(2)).toBe(15000);
    });

    it('clamps to last delay for attempts beyond array length', () => {
      expect(getRetryDelay(3)).toBe(15000);
      expect(getRetryDelay(100)).toBe(15000);
    });

    it('uses custom SLA when provided', () => {
      const sla: HandoffSLA = {
        maxRetryAttempts: 2,
        retryBackoffMs: [500, 2000],
        escalationThresholdMs: 10_000,
      };
      expect(getRetryDelay(0, sla)).toBe(500);
      expect(getRetryDelay(1, sla)).toBe(2000);
      expect(getRetryDelay(5, sla)).toBe(2000);
    });
  });

  describe('shouldEscalate', () => {
    it('returns false for a recent handoff', () => {
      const now = new Date().toISOString();
      expect(shouldEscalate(now)).toBe(false);
    });

    it('returns true for a handoff older than threshold', () => {
      const old = new Date(Date.now() - 600_000).toISOString(); // 10 minutes ago
      expect(shouldEscalate(old)).toBe(true);
    });

    it('returns true when exactly at threshold boundary (just over)', () => {
      const justOver = new Date(Date.now() - 300_001).toISOString();
      expect(shouldEscalate(justOver)).toBe(true);
    });

    it('returns false when just under threshold', () => {
      const justUnder = new Date(Date.now() - 299_999).toISOString();
      expect(shouldEscalate(justUnder)).toBe(false);
    });

    it('respects custom SLA threshold', () => {
      const sla: HandoffSLA = {
        maxRetryAttempts: 3,
        retryBackoffMs: [1000, 5000, 15000],
        escalationThresholdMs: 5_000, // 5 seconds
      };
      const old = new Date(Date.now() - 10_000).toISOString();
      expect(shouldEscalate(old, sla)).toBe(true);

      const recent = new Date().toISOString();
      expect(shouldEscalate(recent, sla)).toBe(false);
    });
  });

  describe('getMaxRetries', () => {
    it('returns default max retries', () => {
      expect(getMaxRetries()).toBe(3);
    });

    it('returns custom max retries from SLA', () => {
      const sla: HandoffSLA = {
        maxRetryAttempts: 5,
        retryBackoffMs: [1000],
        escalationThresholdMs: 60_000,
      };
      expect(getMaxRetries(sla)).toBe(5);
    });
  });
});
