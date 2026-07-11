function emitMetric(metric: string, fields: Record<string, unknown>) {
  console.log('[trust-metric]', JSON.stringify({ ts: new Date().toISOString(), metric, ...fields }));
}

export function recordConsentGranted(sessionId: string): void {
  emitMetric('consent_granted', { sessionId });
}

export function recordConsentDenied(sessionId: string): void {
  emitMetric('consent_denied', { sessionId });
}

export function recordAttachmentQuarantined(reason: string): void {
  emitMetric('attachment_quarantined', { reason });
}

export function recordHandoffDelivered(handoffId: string, durationMs: number): void {
  emitMetric('handoff_delivered', { handoffId, durationMs });
}

export function recordHandoffFailed(handoffId: string, reason: string): void {
  emitMetric('handoff_failed', { handoffId, reason });
}

export function recordCapabilityIssued(sessionId: string): void {
  emitMetric('capability_issued', { sessionId });
}

export function recordCapabilityRejected(sessionId: string): void {
  emitMetric('capability_rejected', { sessionId });
}
