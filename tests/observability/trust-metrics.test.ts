import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  recordConsentGranted,
  recordConsentDenied,
  recordAttachmentQuarantined,
  recordHandoffDelivered,
  recordHandoffFailed,
  recordCapabilityIssued,
  recordCapabilityRejected,
} from '@/lib/observability/trust-metrics';

describe('Trust metrics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recordConsentGranted does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordConsentGranted('sess-123');
    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][1] as string);
    expect(output.metric).toBe('consent_granted');
    expect(output.sessionId).toBe('sess-123');
  });

  it('recordConsentDenied does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordConsentDenied('sess-456');
    const output = JSON.parse(spy.mock.calls[0][1] as string);
    expect(output.metric).toBe('consent_denied');
  });

  it('recordAttachmentQuarantined does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordAttachmentQuarantined('unsupported-mime');
    const output = JSON.parse(spy.mock.calls[0][1] as string);
    expect(output.metric).toBe('attachment_quarantined');
    expect(output.reason).toBe('unsupported-mime');
  });

  it('recordHandoffDelivered does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordHandoffDelivered('ho-1', 1500);
    const output = JSON.parse(spy.mock.calls[0][1] as string);
    expect(output.metric).toBe('handoff_delivered');
    expect(output.durationMs).toBe(1500);
  });

  it('recordHandoffFailed does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordHandoffFailed('ho-2', 'timeout');
    const output = JSON.parse(spy.mock.calls[0][1] as string);
    expect(output.metric).toBe('handoff_failed');
    expect(output.reason).toBe('timeout');
  });

  it('recordCapabilityIssued does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordCapabilityIssued('sess-789');
    const output = JSON.parse(spy.mock.calls[0][1] as string);
    expect(output.metric).toBe('capability_issued');
  });

  it('recordCapabilityRejected does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordCapabilityRejected('sess-000');
    const output = JSON.parse(spy.mock.calls[0][1] as string);
    expect(output.metric).toBe('capability_rejected');
  });
});
