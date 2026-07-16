import { describe, expect, test, vi } from 'vitest';
import { createLogger, extractClientRequestId, extractRequestId } from '@/lib/logger';

describe('createLogger', () => {
  test('includes a stable request id in log entries', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger('test', 'rid-123');

    logger.info('hello', { sessionId: 'sess-1' });

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = spy.mock.calls[0][2] as Record<string, unknown>;
    expect(entry.rid).toBe('rid-123');
    expect(entry.sessionId).toBe('sess-1');
    spy.mockRestore();
  });

  test('redacts sensitive values from context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger('test', 'rid-456');

    logger.info('hello', {
      contactEmail: 'user@example.com',
      url: 'https://example.com/private',
      capability: 'raw-capability',
      messageText: 'secret text',
      fileContent: 'super private'
    });

    const entry = spy.mock.calls[0][2] as Record<string, unknown>;
    expect(entry.contactEmail).toBe('[redacted]');
    expect(entry.url).toBe('[redacted]');
    expect(entry.capability).toBe('[redacted]');
    expect(entry.messageText).toBe('[redacted]');
    expect(entry.fileContent).toBe('[redacted]');
    spy.mockRestore();
  });

  test('recursively redacts PII, filenames, URLs, raw errors, capabilities, and credentials', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger('test', 'rid-789');

    logger.info('safe status', {
      status: 'retrying',
      nested: {
        contactEmail: 'user@example.com',
        fileName: 'private-brief.pdf',
        endpoint: 'https://example.com/private',
        error: new Error('database detail'),
        capability: 'raw-capability',
        apiKey: 'credential'
      }
    });

    const entry = spy.mock.calls[0][2] as Record<string, unknown>;
    expect(entry).toMatchObject({
      status: 'retrying',
      nested: {
        contactEmail: '[redacted]',
        fileName: '[redacted]',
        endpoint: '[redacted]',
        error: '[redacted]',
        capability: '[redacted]',
        apiKey: '[redacted]'
      }
    });
    spy.mockRestore();
  });

  test('redacts neutral-key strings that contain phone numbers, credentials, or capabilities', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger('test', 'rid-neutral');

    logger.info('safe status', {
      status: 'retrying',
      detail: 'Call +65 8123 4567',
      providerDetail: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      correlation: 'cap_abc123def456ghi789'
    });

    const entry = spy.mock.calls[0][2] as Record<string, unknown>;
    expect(entry).toMatchObject({
      status: 'retrying',
      detail: '[redacted]',
      providerDetail: '[redacted]',
      correlation: '[redacted]'
    });
    spy.mockRestore();
  });
});

describe('extractRequestId', () => {
  test('accepts a canonical UUID request id', () => {
    const requestId = '550e8400-e29b-41d4-a716-446655440000';
    const request = new Request('https://example.com', {
      headers: { 'x-request-id': requestId }
    });

    expect(extractRequestId(request)).toBe(requestId);
  });

  test.each([
    ['valid-looking arbitrary token', 'request_token-123.abc'],
    ['secret-bearing', 'Bearer secret-route-token'],
    ['CRLF-bearing', 'safe-id\r\nX-Secret: leaked'],
    ['oversized', 'a'.repeat(65)],
    ['invalid-character', 'attacker@example.com']
  ])('replaces a %s request id with a generated server id', (_case, requestId) => {
    const request = {
      headers: { get: () => requestId }
    } as unknown as Request;

    const extracted = extractRequestId(request);
    expect(extracted).toMatch(/^[a-z0-9-]{8}$/i);
    expect(extracted).not.toContain(requestId);
  });

  test('never writes a rejected request-id header to logs', () => {
    const attackerValue = 'Bearer secret-log-token';
    const request = {
      headers: { get: () => attackerValue }
    } as unknown as Request;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createLogger('test', extractRequestId(request)).warn('safe warning');

    expect(JSON.stringify(spy.mock.calls)).not.toContain(attackerValue);
    const entry = spy.mock.calls[0][2] as Record<string, unknown>;
    expect(entry.rid).toMatch(/^[a-z0-9-]{8}$/i);
    spy.mockRestore();
  });
});

describe('extractClientRequestId', () => {
  test('returns a canonical UUID for relay idempotency', () => {
    const requestId = '8d1f684d-090c-4f67-80d4-317a88ad9cbe';
    const request = new Request('https://example.com', {
      headers: { 'x-request-id': requestId }
    });

    expect(extractClientRequestId(request)).toBe(requestId);
  });

  test.each([null, 'retry-key', 'a'.repeat(65)])(
    'returns null for a missing or invalid relay idempotency key: %s',
    (requestId) => {
      const request = {
        headers: { get: () => requestId }
      } as unknown as Request;

      expect(extractClientRequestId(request)).toBeNull();
    }
  );
});
