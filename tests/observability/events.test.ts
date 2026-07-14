import { describe, expect, test, vi } from 'vitest';
import { emitEvent } from '@/lib/observability/events';

describe('emitEvent', () => {
  test('emits structured JSON to stdout', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitEvent('consent_granted', { sessionId: 'abc-123' });
    expect(spy).toHaveBeenCalledTimes(1);
    const prefix = spy.mock.calls[0][0] as string;
    const jsonStr = spy.mock.calls[0][1] as string;
    expect(prefix).toBe('[trust-event]');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.event).toBe('consent_granted');
    expect(parsed.v).toBe(1);
    expect(parsed.sessionId).toBe('abc-123');
    expect(parsed.ts).toBeDefined();
    spy.mockRestore();
  });

  test('includes requestId when provided', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitEvent('handoff_delivered', { handoffId: 'h-1', durationMs: 150 }, 'req-xyz');
    const jsonStr = spy.mock.calls[0][1] as string;
    const parsed = JSON.parse(jsonStr);
    expect(parsed.rid).toBe('req-xyz');
    spy.mockRestore();
  });

  test('emits a non-PII suppression status for an unavailable handoff session', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitEvent('handoff_suppressed', {
      handoffId: 'h-1',
      reason: 'session_unavailable',
      summary: 'must not be emitted'
    });

    const parsed = JSON.parse(spy.mock.calls[0][1] as string);
    expect(parsed).toMatchObject({ event: 'handoff_suppressed', handoffId: 'h-1', reason: 'session_unavailable' });
    expect(parsed.summary).toBeUndefined();
    spy.mockRestore();
  });

  test('emits only aggregate expiry-worker counts', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitEvent('temporary_sessions_expired', {
      deletedSessions: 2,
      deferredSessions: 1,
      releasedClaims: 3,
      sessionId: 'must-not-be-emitted'
    });

    const parsed = JSON.parse(spy.mock.calls[0][1] as string);
    expect(parsed).toMatchObject({ event: 'temporary_sessions_expired', deletedSessions: 2, deferredSessions: 1, releasedClaims: 3 });
    expect(parsed.sessionId).toBeUndefined();
    spy.mockRestore();
  });

  test('drops non-enumerated reason strings from events', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitEvent('attachment_quarantined', {
      sessionId: 'abc-123',
      reason: 'Invalid MIME type from private-brief.pdf',
      originalName: 'file.pdf',
    });
    const jsonStr = spy.mock.calls[0][1] as string;
    const parsed = JSON.parse(jsonStr);
    expect(parsed.sessionId).toBe('abc-123');
    expect(parsed.reason).toBeUndefined();
    expect(parsed.originalName).toBeUndefined();
    spy.mockRestore();
  });

  test('only emits allowed fields for the event schema', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitEvent('consent_denied', { sessionId: 'abc', extraField: 'should be dropped' });
    const jsonStr = spy.mock.calls[0][1] as string;
    const parsed = JSON.parse(jsonStr);
    expect(parsed.sessionId).toBe('abc');
    expect(parsed.extraField).toBeUndefined();
    spy.mockRestore();
  });

  test('emits allowlisted reason codes', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitEvent('attachment_quarantined', {
      sessionId: 'abc',
      reason: 'telegram_send_failed',
      originalName: 'file.pdf',
    });
    const jsonStr = spy.mock.calls[0][1] as string;
    const parsed = JSON.parse(jsonStr);
    expect(parsed.reason).toBe('telegram_send_failed');
    spy.mockRestore();
  });

  test('drops event reasons that are not stable safe codes', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitEvent('attachment_quarantined', {
      sessionId: 'abc',
      reason: { error: new Error('storage failure'), url: 'https://example.com/private' },
      originalName: 'private-brief.pdf',
    });

    const parsed = JSON.parse(spy.mock.calls[0][1] as string);
    expect(parsed.sessionId).toBe('abc');
    expect(parsed.reason).toBeUndefined();
    expect(parsed.originalName).toBeUndefined();
    spy.mockRestore();
  });

  test('does nothing for unknown event names', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (emitEvent as Function)('unknown_event', { foo: 'bar' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
