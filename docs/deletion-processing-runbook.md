# Deletion Processing Runbook

Authenticated deletion requests create one opaque job and return its current status. `requested`, `claimed`, `processing`, and `failed` mean deletion is not complete; only `completed` confirms the application data deletion.

GitHub Actions invokes the internal deletion worker every five minutes. Investigate an alert when the `deletion-worker` heartbeat is older than 20 minutes or a non-completed deletion job is older than 24 hours. Confirm Storage is available, manually dispatch the GitHub workflow if required, and do not delete session metadata manually: the worker must remove private objects before their metadata and before the session cascade.

The 24-hour threshold is an operational investigation target, not a guaranteed completion time. The worker deletes the temporary session, its owned application rows, and known private attachment objects when storage and provider obligations permit. It cannot retract content already transferred to Telegram or erase provider backups immediately; those systems follow their own retention and deletion processes. Jobs retain only opaque identifiers, lifecycle state, lease data, and timestamps, never deleted draft, contact, attachment, or raw-error data.

The reviewed protected cleanup chain is `038` through `043`, ending with `043_deletion_state_batched_cleanup.sql`. Apply it only through the approved `Production cleanup migrations` workflow, which verifies each allowlisted version, filename, SHA-256 source hash, and the exact `supabase/production-cleanup-038-043.sql` artifact before applying and confirms every version is recorded. A fresh, release-SHA-bound backup attestation is required before execution and retained with the release record. If the managed workflow is unavailable after that attestation and protected approval, use only the exact artifact in the Supabase SQL Editor, never individual pasted migrations. Ordinary releases remain blocked until all six versions are recorded.

## Monday CRM Obligations

Producer-transfer revocation suppresses unsent Monday upserts and queues cleanup for any projection that might have been transferred. A session deletion job waits, rather than fails, while Monday cleanup or an earlier unknown create is unresolved; the deletion worker responds with `status: "deferred"` and retries after five minutes. Do not mark a deletion complete until the scrub, verification, and provider delete have completed.

Qualified CRM records are review-due after 90 days. An explicit BD renewal recorded with a PII-free approved case reference makes the record active for another 90 days. Otherwise it becomes `review_overdue`, and after its 30-day grace period lifecycle cleanup is queued. `needs_review`, `misfit`, and `unqualified` records are queued after 30 days. Each review or expiry action must be resolved within one business day.

For a privacy request after temporary-session expiry, use this operator procedure before invoking the DSR script:

1. Open the privacy case and record the request time, assigned operator, and a PII-free case reference. Do not record PII, request content, or identity documents in the CRM lifecycle audit.
2. Verify the requester through a previously approved contact method already held in the privacy case, using a one-time challenge. If that method is unavailable, require documented privacy-officer approval before proceeding.
3. An independent privacy reviewer confirms the challenge result, authority to act where applicable, and the opaque CRM ID obtained through the restricted case-management lookup. Never search Monday or the database by name or email.
4. The executing operator runs `node --env-file="D:\Development Projects\Balance-Assist\.env" scripts/request-monday-dsr.mjs <opaque-crm-record-id> <case-reference>` and records only its success/failure and timestamp in the case.
5. Monitor the deletion job through provider scrub, verification, and delete. Escalate any unresolved provider cleanup within one business day; do not promise completion while Monday Trash or provider escalation remains outstanding.

Never pass, print, or log a name or email. The script accepts only the opaque CRM UUID and case reference and prints no CRM payload.

Monday Trash may retain deleted data for 30 days. A verified request requiring earlier permanent provider erasure must be escalated through Monday support using the approved privacy case. Preserve the provider escalation reference in the case system, not in the CRM lifecycle audit. Monday remains disabled pending the required revocation drill: `MONDAY_UPSERT_ENABLED` and `MONDAY_CLEANUP_ENABLED` must stay `false`.
