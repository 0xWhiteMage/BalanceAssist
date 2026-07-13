# Trust Metrics

## Purpose

These metrics track whether Balance Assist is behaving as a consent-led, truthful intake and handoff system.

## Event Sources

- `consent_granted`: session creation after explicit notice acknowledgment
- `capability_issued`: session capability issuance
- `lead_persisted`: canonical brief persisted successfully
- `lead_skipped`: finalization skipped because canonical brief lacked substance
- `handoff_enqueued`: producer handoff queued after persistence
- `attachment_forwarded`: upload persisted and forwarded to Telegram
- `attachment_quarantined`: upload persisted without forwarding
- `draft_updated`: canonical draft edit persisted through the authenticated route
- `deletion_requested`: durable deletion request recorded
- `project_reset`: canonical project reset completed and capability revoked

## Privacy Rules

- Never emit message text, URLs, file contents, raw capabilities, signed URLs, credentials, or secret values.
- File/link metrics should use status and coarse metadata only.
- Contact information must not be logged in trust events.

## Operational Use

- Monitor spikes in `attachment_quarantined` for upload abuse or MIME regressions.
- Compare `lead_persisted` to `handoff_enqueued` to catch producer-transfer failures.
- Monitor `project_reset` and `deletion_requested` to verify user data-control paths remain functional.
- Monitor absence of `consent_granted` against traffic expectations to detect intake breakage.

## Ownership

- Product engineering owns schema changes and emitter wiring.
- Operations owns alert thresholds and runbook execution.
