import { describe, it, expect, afterEach } from 'vitest';
import { requireAdminConfig, requireWebhookSecret } from '@/lib/security/config';
import { getAllowedOrigins, isAllowedOrigin, requireTrustedOrigin } from '@/lib/security/origin';

describe('security/config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('requireAdminConfig', () => {
    it('returns config when SETUP_TOKEN is set', () => {
      process.env.SETUP_TOKEN = 'test-token-123';
      const config = requireAdminConfig();
      expect(config.setupToken).toBe('test-token-123');
    });

    it('throws when SETUP_TOKEN is missing', () => {
      delete process.env.SETUP_TOKEN;
      expect(() => requireAdminConfig()).toThrow('SETUP_TOKEN');
    });

    it('throws when SETUP_TOKEN is empty', () => {
      process.env.SETUP_TOKEN = '';
      expect(() => requireAdminConfig()).toThrow('SETUP_TOKEN');
    });
  });

  describe('requireWebhookSecret', () => {
    it('returns config when TELEGRAM_WEBHOOK_SECRET is set', () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = 'whsec-abc';
      const config = requireWebhookSecret();
      expect(config.webhookSecret).toBe('whsec-abc');
    });

    it('throws when TELEGRAM_WEBHOOK_SECRET is missing in production', () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      expect(() => requireWebhookSecret()).toThrow('TELEGRAM_WEBHOOK_SECRET');
    });

    it('allows missing webhook secret in development', () => {
      (process.env as Record<string, string>).NODE_ENV = 'development';
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      const config = requireWebhookSecret();
      expect(config.webhookSecret).toBeNull();
    });
  });
});

describe('security/origin', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getAllowedOrigins', () => {
    it('returns default Balance origins', () => {
      delete process.env.ALLOWED_ORIGINS;
      const origins = getAllowedOrigins();
      expect(origins).toContain('https://balancestudio.tv');
      expect(origins).toContain('https://www.balancestudio.tv');
    });

    it('includes custom origins from env', () => {
      process.env.ALLOWED_ORIGINS = 'https://custom.tv,https://other.com';
      const origins = getAllowedOrigins();
      expect(origins).toContain('https://custom.tv');
      expect(origins).toContain('https://other.com');
      expect(origins).toContain('https://balancestudio.tv');
    });
  });

  describe('isAllowedOrigin', () => {
    it('allows Balance studio origin', () => {
      expect(isAllowedOrigin('https://www.balancestudio.tv')).toBe(true);
    });

    it('rejects unknown origin', () => {
      expect(isAllowedOrigin('https://evil.com')).toBe(false);
    });

    it('rejects null origin', () => {
      expect(isAllowedOrigin(null)).toBe(false);
    });

    it('allows localhost in development', () => {
      (process.env as Record<string, string>).NODE_ENV = 'development';
      expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    });
  });

  describe('requireTrustedOrigin', () => {
    it('returns the origin when allowed', () => {
      const result = requireTrustedOrigin('https://www.balancestudio.tv');
      expect(result).toBe('https://www.balancestudio.tv');
    });

    it('throws when origin is not allowed', () => {
      expect(() => requireTrustedOrigin('https://evil.com')).toThrow('Untrusted origin');
    });

    it('throws when origin is null', () => {
      expect(() => requireTrustedOrigin(null)).toThrow('Untrusted origin');
    });
  });
});
