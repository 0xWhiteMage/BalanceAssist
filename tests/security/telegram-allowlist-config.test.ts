import { describe, expect, test } from 'vitest';
import { parseTelegramSenderAllowlist } from '@/lib/security/config';

describe('Telegram sender allowlist configuration', () => {
  test('parses and deduplicates immutable numeric user IDs', () => {
    expect(parseTelegramSenderAllowlist({ TELEGRAM_ALLOWED_USER_IDS: '42, 77,42' })).toEqual({
      ok: true,
      userIds: [42, 77]
    });
  });

  test('fails closed with an explicit migration message for the legacy username setting', () => {
    expect(parseTelegramSenderAllowlist({ TELEGRAM_ALLOWED_USERNAMES: 'admin' })).toEqual({
      ok: false,
      error: 'TELEGRAM_ALLOWED_USERNAMES is no longer supported; migrate to TELEGRAM_ALLOWED_USER_IDS'
    });
  });

  test.each(['', '0', '-1', '42,admin', '9007199254740992'])(
    'rejects an absent or invalid numeric allowlist %j',
    (value) => {
      expect(parseTelegramSenderAllowlist({ TELEGRAM_ALLOWED_USER_IDS: value }).ok).toBe(false);
    }
  );
});
