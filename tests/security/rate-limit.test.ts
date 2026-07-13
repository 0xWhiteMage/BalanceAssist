import { describe, expect, test } from 'vitest';
import { getClientIpMaterial, hashRateLimitKey } from '@/lib/security/rate-limit';

describe('rate limit key material', () => {
  test('hashes limiter keys without retaining their source material', () => {
    const source = 'chat:capability.secret';

    const key = hashRateLimitKey(source);

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain(source);
  });

  test('uses the first forwarded address and a safe fallback when proxy headers are absent', () => {
    const forwarded = new Request('https://balancestudio.tv/api/sessions', {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.2' }
    });
    const absent = new Request('https://balancestudio.tv/api/sessions');

    expect(getClientIpMaterial(forwarded)).toBe('203.0.113.10');
    expect(getClientIpMaterial(absent)).toBe('missing-forwarded-ip');
  });
});
