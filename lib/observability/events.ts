import { sanitizeObservabilityData } from '@/lib/observability/sanitize';
import { trustFeedbackPropertiesSchema } from '@/lib/api/contracts';

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
  | 'memory_inspected'
  | 'memory_reset_requested'
  | 'memory_correction_requested'
  | 'widget_closed'
  | 'human_handoff'
  | 'step_advanced'
  | 'trust_feedback'
  | 'temporary_sessions_expired'
  | 'monday_sync_succeeded'
  | 'monday_sync_failed'
  | 'monday_sync_unknown'
  | 'monday_sync_conflict'
  | 'monday_sync_suppressed'
  | 'monday_schema_drift';

type EventSchemaVersion = 1;
const SAFE_REASON_CODES = [
  'attachment_invalid',
  'handoff_processing_failed',
  'handoff_type_invalid',
  'producer_transfer_revoked',
  'session_unavailable',
  'telegram_send_failed',
  'monday_auth_failed',
  'monday_permission_denied',
  'monday_rate_limited',
  'monday_schema_drift',
  'monday_payload_invalid',
  'monday_temporary_failure',
  'monday_provider_idempotency_conflict',
  'monday_delivery_unknown',
  'monday_duplicate_key_conflict'
] as const;

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
  memory_inspected: { version: 1, fields: ['sessionId'] },
  memory_reset_requested: { version: 1, fields: ['sessionId'] },
  memory_correction_requested: { version: 1, fields: ['sessionId'] },
  widget_closed: { version: 1, fields: ['sessionId'] },
  human_handoff: { version: 1, fields: ['sessionId'] },
  step_advanced: { version: 1, fields: ['sessionId', 'from', 'to'] },
  trust_feedback: { version: 1, fields: ['sessionId', 'dimension', 'response'] },
  temporary_sessions_expired: { version: 1, fields: ['deletedSessions', 'deferredSessions', 'releasedClaims'] },
  monday_sync_succeeded: { version: 1, fields: ['crmRecordId', 'syncId', 'revision', 'durationMs'] },
  monday_sync_failed: { version: 1, fields: ['crmRecordId', 'syncId', 'revision', 'durationMs', 'reason'] },
  monday_sync_unknown: { version: 1, fields: ['crmRecordId', 'syncId', 'revision', 'durationMs', 'reason'] },
  monday_sync_conflict: { version: 1, fields: ['crmRecordId', 'syncId', 'revision', 'durationMs', 'reason'] },
  monday_sync_suppressed: { version: 1, fields: ['crmRecordId', 'syncId', 'revision', 'durationMs', 'reason'] },
  monday_schema_drift: { version: 1, fields: ['reason'] },
};

export function emitEvent(
  eventName: EventName,
  data: Record<string, unknown>,
  requestId?: string
): void {
  const schema = EVENT_SCHEMAS[eventName];
  if (!schema) return;

  let redacted = sanitizeObservabilityData(data, schema.fields, SAFE_REASON_CODES);
  if (eventName === 'trust_feedback') {
    const feedback = trustFeedbackPropertiesSchema.safeParse({
      dimension: redacted.dimension,
      response: redacted.response
    });
    if (!feedback.success) return;
    redacted = { sessionId: redacted.sessionId, ...feedback.data };
  }

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
