import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { decryptMondaySecret, encryptMondaySecret } from '../../lib/monday/oauth-crypto';

const environment = { MONDAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') };

describe('Monday OAuth encryption envelopes', () => {
  test('round trips with AES-256-GCM and binds ciphertext to AAD', () => {
    const envelope = encryptMondaySecret('refresh-token-secret', 'refresh-token', environment);
    expect(envelope).toMatch(/^v1\.[^.]+\.[^.]+\.[^.]+$/);
    expect(envelope).not.toContain('refresh-token-secret');
    expect(decryptMondaySecret(envelope, 'refresh-token', environment)).toBe('refresh-token-secret');
    expect(() => decryptMondaySecret(envelope, 'access-token', environment)).toThrow('Invalid Monday secret envelope');
  });

  test('rejects malformed key material and tampered ciphertext', () => {
    expect(() => encryptMondaySecret('secret', 'aad', { MONDAY_TOKEN_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow('32 bytes');
    const envelope = encryptMondaySecret('secret', 'aad', environment);
    expect(() => decryptMondaySecret(`${envelope}A`, 'aad', environment)).toThrow('Invalid Monday secret envelope');
  });
});
