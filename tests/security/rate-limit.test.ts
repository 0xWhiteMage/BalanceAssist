import { afterEach, describe, expect, test } from 'vitest';
import { getClientIpMaterial, hashRateLimitKey } from '@/lib/security/rate-limit';

describe('rate limit key material', () => {
  const originalTrustedHeader = process.env.TRUSTED_CLIENT_IP_HEADER;

  afterEach(() => {
    if (originalTrustedHeader === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
    else process.env.TRUSTED_CLIENT_IP_HEADER = originalTrustedHeader;
  });
  test('hashes limiter keys without retaining their source material', () => {
    const source = 'chat:capability.secret';

    const key = hashRateLimitKey(source);

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain(source);
  });

  test('ignores spoofable forwarding headers when no trusted deployment header is configured', () => {
    const spoofed = new Request('https://balancestudio.tv/api/sessions', {
      headers: { 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '203.0.113.11' }
    });

    expect(getClientIpMaterial(spoofed)).toBe('untrusted-client-ip');
  });

  test('uses Vercel-sanitized client address only when explicitly configured', () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-vercel-forwarded-for';
    const request = new Request('https://balancestudio.tv/api/sessions', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.10',
        'x-forwarded-for': '198.51.100.9'
      }
    });

    expect(getClientIpMaterial(request)).toBe('203.0.113.10');
  });
});
