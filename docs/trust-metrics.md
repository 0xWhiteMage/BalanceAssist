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

## Privacy Rules

- Events use a recursive field allowlist/redaction utility. Never emit PII, filenames, URLs, file contents, raw errors, capabilities, signed URLs, credentials, or secrets.
- Private-file metrics use only non-identifying status or aggregate counts. Analysis-only files are not producer-transfer artifacts.

## Operational Use

- Monitor spikes in `attachment_quarantined` for upload abuse or MIME regressions; no filename is available for investigation.
- Compare `lead_persisted` to `handoff_enqueued` to catch producer-transfer failures.
- Monitor `handoff_failed` and `handoff_escalated` alongside GitHub Actions `Handoff dispatch` workflow failures and pending outbox age.
- Monitor `handoff_suppressed` to identify handoffs that expired before delivery without logging their content.
- Monitor `temporary_sessions_expired.deferredSessions` for in-flight handoffs. A valid dispatch claim authorizes completion and cannot be retracted; lost acknowledgement can cause at-least-once Telegram delivery.
- Monitor `project_reset` and `deletion_requested` to verify user data-control paths remain functional.
- Monitor absence of `consent_granted` against traffic expectations to detect intake breakage.

## Ownership

- Product engineering owns schema changes and emitter wiring.
- Operations owns alert thresholds and runbook execution.
