# Trust Metrics

## Purpose

These metrics track whether Balance Assist is behaving as a consent-led, truthful intake and handoff system.

## Event Sources

- `consent_granted`: session creation after explicit notice acknowledgment
- `capability_issued`: session capability issuance
- `lead_persisted`: canonical brief persisted successfully
- `lead_skipped`: finalization skipped because canonical brief lacked substance
- `handoff_enqueued`: producer handoff queued after persistence
- `handoff_delivered`: dispatcher delivered a handoff to Telegram
- `handoff_failed`: dispatcher could not deliver a handoff and scheduled or exhausted a retry
- `handoff_escalated`: dispatcher found a handoff beyond the 15-minute escalation threshold
- `handoff_suppressed`: claim-time eligibility withheld an unclaimed handoff because its session was expired or producer transfer was revoked
- `temporary_sessions_expired`: expiry worker aggregate counts for deleted sessions, deferred active claims, and released leases
- `attachment_quarantined`: an analysis-only attachment was rejected before storage
- `draft_updated`: canonical draft edit persisted through the authenticated route
- `deletion_requested`: durable deletion request recorded
- `project_reset`: canonical project reset completed and capability revoked
- `trust_feedback`: one explicit bounded response with `dimension` set to `clarity_helpfulness`, `comfort`, or `reuse`, and `response` set to `yes` or `not_quite`
- `human_handoff`: the user explicitly chose the human-only route after contact consent was saved and the local relay entered its requested state; it does not prove message delivery or a team connection

## Feedback Collection

- The current UI asks `Was this clear?` only after a brief has been successfully saved. It records `trust_feedback { dimension: clarity_helpfulness, response: yes | not_quite }`.
- Comfort and willingness-to-reuse schemas are available but are not collected until separate prompts and eligibility rules are approved. A clarity answer must never be reused as either signal.
- The prompt does not create a session, does not appear while deletion is frozen, and does not claim feedback was saved until the authenticated event route confirms persistence.
- No comment field is offered. Any future comment path requires separate consent and a content destination outside telemetry.

## Metric Definitions

- Clarity/helpfulness rate: first `yes` clarity response per eligible session divided by sessions with a first clarity response. Report `not_quite` separately rather than treating missing responses as negative.
- Human escalation rate: sessions with `human_handoff` divided by sessions that started either the AI or human path. This describes user choice, not dissatisfaction.
- Comfort and reuse rates remain unreported until their explicit prompts ship.
- Deduplicate retries by using only the earliest event for each session and dimension. The current database accepts retries so feedback remains available during transient response loss.
- Do not report small cohorts that could make individual sessions identifiable. Product and Operations must approve the minimum cohort before dashboard publication.

## Privacy Rules

- Events use a recursive field allowlist/redaction utility. Never emit PII, filenames, URLs, file contents, raw errors, capabilities, signed URLs, credentials, or secrets.
- Private-file metrics use only non-identifying status or aggregate counts. Analysis-only files are not producer-transfer artifacts.
- The public event API uses strict per-event schemas and a 2 KB body limit. Feedback accepts only its dimension and response enums; free text, transcripts, contact data, comments, and provider errors are rejected.
- Feedback rows in the `events` table share the temporary session lifecycle and are deleted when their session is deleted or expires. Bounded schema-compliance log entries are separate operational records governed by platform log retention; they contain the session identifier, dimension, response, schema version, and request ID only. Feedback does not extend session retention.

## Operational Use

- Monitor spikes in `attachment_quarantined` for upload abuse or MIME regressions; no filename is available for investigation.
- Compare `lead_persisted` to `handoff_enqueued` to catch producer-transfer failures.
- Monitor `handoff_failed` and `handoff_escalated` alongside GitHub Actions `Handoff dispatch` workflow failures and pending outbox age.
- Monitor `handoff_suppressed` to identify handoffs that expired before delivery without logging their content.
- Monitor `temporary_sessions_expired.deferredSessions` for in-flight handoffs. A valid dispatch claim authorizes completion and cannot be retracted; lost acknowledgement can cause at-least-once Telegram delivery.
- Monitor `project_reset` and `deletion_requested` to verify user data-control paths remain functional.
- Monitor absence of `consent_granted` against traffic expectations to detect intake breakage.
- Review clarity and human-escalation rates weekly for product learning, not individual profiling. Investigate schema or delivery drops before interpreting response movement.

## Ownership

- Product engineering owns schema changes and emitter wiring.
- Operations owns alert thresholds and runbook execution.
- Product owns prompt wording, eligibility, cohort thresholds, and interpretation. Privacy review is required before adding a comment path or a new feedback dimension.
