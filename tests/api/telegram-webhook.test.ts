import { describe, it, expect } from 'vitest';
import {
  verifyWebhookSecret,
  verifyWebhookChatId,
  verifyWebhookSender,
  validateWebhookRequest
} from '@/lib/telegram/webhook-auth';

describe('verifyWebhookSecret', () => {
  it('returns true for matching secrets', () => {
    expect(verifyWebhookSecret('my-secret', 'my-secret')).toBe(true);
  });

  it('returns false for mismatched secrets', () => {
    expect(verifyWebhookSecret('wrong', 'correct')).toBe(false);
  });

  it('returns false when header is null', () => {
    expect(verifyWebhookSecret(null, 'correct')).toBe(false);
  });

  it('returns false when configured is null', () => {
    expect(verifyWebhookSecret('header', null)).toBe(false);
  });

  it('uses timing-safe comparison (same length, different content)', () => {
    expect(verifyWebhookSecret('aaaa', 'bbbb')).toBe(false);
  });

  it('returns false for different length secrets', () => {
    expect(verifyWebhookSecret('short', 'longer-secret')).toBe(false);
  });
});

describe('verifyWebhookChatId', () => {
  it('returns true for matching chat ID', () => {
    expect(verifyWebhookChatId(123456, '123456')).toBe(true);
  });

  it('returns false for mismatched chat ID', () => {
    expect(verifyWebhookChatId(123456, '654321')).toBe(false);
  });

  it('returns false when configured is null', () => {
    expect(verifyWebhookChatId(123456, null)).toBe(false);
  });
});

describe('verifyWebhookSender', () => {
  it('returns true when no allowlist is configured', () => {
    expect(verifyWebhookSender('anyone', null)).toBe(true);
  });

  it('returns true for matching username', () => {
    expect(verifyWebhookSender('admin', ['admin', 'mod'])).toBe(true);
  });

  it('returns true case-insensitively', () => {
    expect(verifyWebhookSender('Admin', ['admin'])).toBe(true);
  });

  it('returns false for unknown sender', () => {
    expect(verifyWebhookSender('hacker', ['admin'])).toBe(false);
  });

  it('returns false when sender is null but allowlist exists', () => {
    expect(verifyWebhookSender(null, ['admin'])).toBe(false);
  });
});

describe('validateWebhookRequest', () => {
  it('rejects when secret is not configured', () => {
    const result = validateWebhookRequest({
      headerSecret: null,
      configuredSecret: null,
      incomingChatId: 123,
      configuredChatId: '123',
      senderUsername: 'admin',
      allowedUsernames: null
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing-secret');
  });

  it('rejects invalid secret', () => {
    const result = validateWebhookRequest({
      headerSecret: 'wrong',
      configuredSecret: 'correct',
      incomingChatId: 123,
      configuredChatId: '123',
      senderUsername: 'admin',
      allowedUsernames: null
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-secret');
  });

  it('rejects wrong chat ID', () => {
    const result = validateWebhookRequest({
      headerSecret: 'secret',
      configuredSecret: 'secret',
      incomingChatId: 999,
      configuredChatId: '123',
      senderUsername: 'admin',
      allowedUsernames: null
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong-chat');
  });

  it('rejects unauthorized sender', () => {
    const result = validateWebhookRequest({
      headerSecret: 'secret',
      configuredSecret: 'secret',
      incomingChatId: 123,
      configuredChatId: '123',
      senderUsername: 'hacker',
      allowedUsernames: ['admin']
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized-sender');
  });

  it('accepts valid request', () => {
    const result = validateWebhookRequest({
      headerSecret: 'secret',
      configuredSecret: 'secret',
      incomingChatId: 123,
      configuredChatId: '123',
      senderUsername: 'admin',
      allowedUsernames: ['admin']
    });
    expect(result.ok).toBe(true);
  });
});
