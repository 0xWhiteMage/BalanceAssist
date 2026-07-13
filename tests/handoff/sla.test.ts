import { describe, it, expect } from 'vitest';
import { getRetryDelay, shouldEscalate, getMaxRetries, type HandoffSLA } from '@/lib/handoff/sla';

describe('handoff/sla', () => {
  describe('getRetryDelay', () => {
    it('does not promise a retry before the five-minute scheduler cadence', () => {
      expect(getRetryDelay(0)).toBe(300_000);
    });

    it('returns second delay for attempt 1', () => {
      expect(getRetryDelay(1)).toBe(300_000);
    });

    it('returns third delay for attempt 2', () => {
      expect(getRetryDelay(2)).toBe(300_000);
    });

    it('clamps to last delay for attempts beyond array length', () => {
      expect(getRetryDelay(3)).toBe(300_000);
      expect(getRetryDelay(100)).toBe(300_000);
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

    it('returns true for a handoff older than the three-cadence threshold', () => {
      const old = new Date(Date.now() - 1_200_000).toISOString(); // 20 minutes ago
      expect(shouldEscalate(old)).toBe(true);
    });

    it('returns true when exactly at threshold boundary (just over)', () => {
      const justOver = new Date(Date.now() - 900_001).toISOString();
      expect(shouldEscalate(justOver)).toBe(true);
    });

    it('returns false when just under threshold', () => {
      const justUnder = new Date(Date.now() - 899_999).toISOString();
      expect(shouldEscalate(justUnder)).toBe(false);
    });

    it('respects custom SLA threshold', () => {
      const sla: HandoffSLA = {
        maxRetryAttempts: 3,
        retryBackoffMs: [300_000, 300_000, 300_000],
        escalationThresholdMs: 5_000, // 5 seconds
      };
      const old = new Date(Date.now() - 10_000).toISOString();
      expect(shouldEscalate(old, sla)).toBe(true);

      const recent = new Date().toISOString();
      expect(shouldEscalate(recent, sla)).toBe(false);
    });
  });

  describe('getMaxRetries', () => {
    it('returns the default four delivery attempts', () => {
      expect(getMaxRetries()).toBe(4);
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
