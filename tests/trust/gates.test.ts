import { describe, it, expect } from 'vitest';
import {
  requireConsentBeforeSend,
  requireCapabilityForAction,
  validateDeliveryState,
  requireAdminConfig,
} from '@/lib/trust/gates';

describe('Trust gates', () => {
  describe('requireConsentBeforeSend', () => {
    it('passes when consent is true', () => {
      expect(requireConsentBeforeSend(true, 'analytics')).toEqual({ passed: true });
    });

    it('fails when consent is false', () => {
      const result = requireConsentBeforeSend(false, 'analytics');
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('analytics');
    });
  });

  describe('requireCapabilityForAction', () => {
    it('passes when capability is valid', () => {
      expect(requireCapabilityForAction(true, 'read-draft')).toEqual({ passed: true });
    });

    it('fails when capability is invalid', () => {
      const result = requireCapabilityForAction(false, 'read-draft');
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('read-draft');
    });
  });

  describe('validateDeliveryState', () => {
    it('passes when delivered', () => {
      expect(validateDeliveryState(true, false, false)).toEqual({ passed: true });
    });

    it('passes when queued', () => {
      expect(validateDeliveryState(false, true, false)).toEqual({ passed: true });
    });

    it('passes when retryable', () => {
      expect(validateDeliveryState(false, false, true)).toEqual({ passed: true });
    });

    it('fails when none are true', () => {
      const result = validateDeliveryState(false, false, false);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('invalid');
    });
  });

  describe('requireAdminConfig', () => {
    it('passes when all keys are present', () => {
      expect(requireAdminConfig({ SETUP_TOKEN: 'abc', BOT_TOKEN: 'def' })).toEqual({ passed: true });
    });

    it('fails when a key is missing', () => {
      const result = requireAdminConfig({ SETUP_TOKEN: 'abc', BOT_TOKEN: undefined });
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('BOT_TOKEN');
    });

    it('fails when multiple keys are missing', () => {
      const result = requireAdminConfig({ SETUP_TOKEN: undefined, BOT_TOKEN: undefined });
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('SETUP_TOKEN');
      expect(result.reason).toContain('BOT_TOKEN');
    });
  });
});
