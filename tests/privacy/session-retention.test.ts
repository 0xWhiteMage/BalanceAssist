import { describe, expect, test } from 'vitest';
import { temporaryDraftExpiry } from '@/lib/privacy/session-retention';

describe('temporary draft retention', () => {
  test('sets expiry exactly 24 hours after activity', () => {
    expect(temporaryDraftExpiry(new Date('2026-07-13T12:00:00.000Z')).toISOString()).toBe('2026-07-14T12:00:00.000Z');
  });
});
