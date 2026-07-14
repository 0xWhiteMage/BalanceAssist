import { sanitizeObservabilityData } from '@/lib/observability/sanitize';

type EventName =
  | 'consent_granted'
  | 'consent_denied'
  | 'attachment_quarantined'
  | 'handoff_enqueued'
  | 'handoff_delivered'
  | 'handoff_failed'
  | 'handoff_escalated'
  | 'handoff_suppressed'
  | 'capability_issued'
  | 'capability_rejected'
  | 'lead_persisted'
  | 'lead_skipped'
  | 'llm_request'
  | 'topic_created'
  | 'session_status_changed'
  | 'draft_updated'
  | 'correction_requested'
  | 'deletion_requested'
  | 'project_reset'
  | 'temporary_sessions_expired';

type EventSchemaVersion = 1;

const EVENT_SCHEMAS: Record<EventName, { version: EventSchemaVersion; fields: readonly string[] }> = {
  consent_granted: { version: 1, fields: ['sessionId', 'consentVersion'] },
  consent_denied: { version: 1, fields: ['sessionId'] },
  attachment_quarantined: { version: 1, fields: ['sessionId', 'reason'] },
  handoff_enqueued: { version: 1, fields: ['sessionId', 'handoffId', 'caseId', 'routingDestination'] },
  handoff_delivered: { version: 1, fields: ['handoffId', 'durationMs'] },
  handoff_failed: { version: 1, fields: ['handoffId', 'reason'] },
  handoff_escalated: { version: 1, fields: ['handoffId', 'reason'] },
  handoff_suppressed: { version: 1, fields: ['handoffId', 'reason'] },
  capability_issued: { version: 1, fields: ['sessionId'] },
  capability_rejected: { version: 1, fields: ['sessionId'] },
  lead_persisted: { version: 1, fields: ['sessionId', 'qualificationStatus', 'score'] },
  lead_skipped: { version: 1, fields: ['sessionId', 'reason'] },
  llm_request: { version: 1, fields: ['sessionId', 'category', 'hasDraft'] },
  topic_created: { version: 1, fields: ['sessionId', 'caseId', 'threadId'] },
  session_status_changed: { version: 1, fields: ['sessionId', 'newStatus'] },
  draft_updated: { version: 1, fields: ['sessionId', 'field', 'provenance'] },
  correction_requested: { version: 1, fields: ['sessionId', 'field'] },
  deletion_requested: { version: 1, fields: ['sessionId'] },
  project_reset: { version: 1, fields: ['sessionId', 'draftVersion'] },
  temporary_sessions_expired: { version: 1, fields: ['deletedSessions', 'deferredSessions', 'releasedClaims'] },
};

export function emitEvent(
  eventName: EventName,
  data: Record<string, unknown>,
  requestId?: string
): void {
  const schema = EVENT_SCHEMAS[eventName];
  if (!schema) return;

  const redacted = sanitizeObservabilityData(data, schema.fields);

  const entry = {
    ts: new Date().toISOString(),
    event: eventName,
    v: schema.version,
    ...(requestId ? { rid: requestId } : {}),
    ...redacted,
  };

  console.log('[trust-event]', JSON.stringify(entry));
}

export type { EventName };
