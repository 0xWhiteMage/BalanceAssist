import { describe, expect, test, vi } from 'vitest';
import { createLogger } from '@/lib/logger';

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
});
