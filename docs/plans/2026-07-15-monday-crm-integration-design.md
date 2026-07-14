# Monday CRM Integration Design

## Status

Approved on 2026-07-15. This design supersedes the implementation assumptions in
`2026-07-14-monday-crm-integration-handoff.md`, which was written against an
older `main`.

## Intent

Project explicitly approved Balance Assist leads into Monday so Business
Development can triage and progress them. Balance Assist remains authoritative
for captured facts, qualification, consent, and approved revisions. Monday owns
the sales workflow: owner, pipeline stage after creation, follow-up, meetings,
sales notes, and loss outcome.

The user response must never wait for Monday. The integration is a consented
external-delivery boundary with durable retry, reconciliation, retention, and
deletion behavior.

## Architecture

```text
temporary session + canonical draft
  -> producer-transfer consent
  -> explicit approval
  -> one database transaction
       -> durable approved CRM lead revision
       -> Monday projection obligation
       -> existing Telegram handoff obligation
  -> authenticated scheduled Monday worker
       -> lease + eligibility recheck + schema preflight
       -> create or update Monday item
       -> durable receipt
  -> reconciliation, retention, and deletion/scrub
```

Temporary conversational data keeps its 24-hour lifecycle. Explicit approval
creates a separate durable CRM record governed by a lifecycle retention policy.
This avoids making all session data durable while giving reconciliation a stable
source after the session expires.

## Source Model

Create an application-owned durable CRM aggregate with:

- An opaque `crm_record_id` used as Monday's external key.
- A nullable source session association that can be removed after session expiry.
- A monotonic approved revision.
- A versioned, validated snapshot of only CRM-approved fields.
- Current desired/applied revision and Monday item receipt.
- Lifecycle retention, deletion, and sync state without raw provider errors.

The first explicit approval creates revision 1. Later draft edits do not change
Monday implicitly. A later explicit approval creates a new revision. A retry
always replays the same approved revision.

## Projection Contract

Minimum Monday fields:

- CRM record ID.
- Qualification status and score.
- Recommended next step.
- Approval/submission timestamp.
- Source channel.

Nullable source-owned fields:

- Contact name and email.
- Company.
- Service, project type, scope, timeline, and budget.
- Producer-approved reference links, only if lifecycle policy permits them.

Never export:

- Analysis-only files, filenames, object keys, signed URLs, or extracted text.
- Telegram identifiers.
- AI-consent history.
- Full referrers, source URLs, or UTM values without a documented BD purpose.
- Raw internal errors or provider responses.

The board must not require both name and email while product approval permits
either. Missing values remain missing. Item names use available real project data
plus a short opaque identifier; no data is fabricated.

## Field Ownership

Create and update payloads use separate allowlists. Updates omit all
Monday-owned fields; `null` is never used to clear them.

Balance Assist owns CRM record ID, approved contact/project facts,
qualification, recommendation, source channel, consented links, and approved
revision metadata.

Monday owns Owner, follow-up, meetings, sales notes, loss reason, and pipeline
stage after initial creation. Source-owned and human override fields should be
separate when BD needs to correct source data without having it overwritten.

## Delivery Semantics

Finalization and CRM enqueue occur in one database transaction. The worker uses
the existing trust-first outbox pattern:

- `FOR UPDATE SKIP LOCKED` claims.
- Expiring leases and random claim tokens.
- Eligibility checks at claim and immediately before mutation.
- A `sending` reservation before the external call.
- Token-guarded completion and failure transitions.
- Bounded batches, retries, and stable sanitized reason codes.

The system is at-least-once across the external boundary. It uses Monday's
`Idempotency-Key` for short retry windows and Supabase for durable business
idempotency. A create timeout enters `delivery_unknown`; the worker searches by
the opaque CRM key before considering another create.

Once known, `monday_item_id` is the normal update target. Exact key lookup is a
recovery mechanism, not the routine update path. Duplicate external keys enter a
terminal conflict state and require operator review.

## Monday API Contract

- Pin `API-Version: 2026-07` after a live compatibility smoke test.
- Send the token directly in `Authorization` as documented by Monday.
- Prefer OAuth for stored background access; a temporary personal token is
  broad, user-bound, and limited by that user's UI permissions.
- Call root-level `items_page_by_column_values(board_id: ...)`.
- Treat only a validated empty result as absence; null or malformed data is an
  error.
- Alias and validate mutation output before accepting an item ID.
- Parse HTTP status, `errors[].extensions.code`, `Retry-After`, rate headers,
  request ID, and effective API version.
- Use stable label IDs and canonical JSON column shapes.

## Lifecycle Policy

Use the approved lifecycle model:

- Active opportunities persist while sales work is active.
- Stale, unqualified, and closed records expire or anonymize on documented
  schedules owned by BD and privacy stakeholders.
- Explicit user deletion creates a durable Monday delete/scrub obligation before
  local deletion is reported complete.
- Unsent work is suppressed after consent revocation or deletion begins.
- Completed lifecycle actions retain only a PII-free tombstone where required
  for operational audit.

Automatic expiry of the temporary browser session does not delete an explicitly
approved CRM record. It removes the temporary source association and
conversational data.

## Operations

Run a bounded authenticated internal worker through GitHub Actions, matching the
existing handoff, expiry, deletion, and scheduler-health patterns. Add heartbeat,
backlog age, conflict, delivery-unknown, schema-drift, and credential health.

Reconciliation starts from stored Monday item IDs and a paginated board snapshot.
It detects missing items, duplicate CRM keys, key changes, item moves/deletion,
and source-owned field drift. Webhooks are optional acceleration, not the sole
correctness mechanism.

Before enabling writes, verify a checked-in board schema fingerprint: account,
board ID, column IDs and types, status label IDs, required-field rules, and API
version. Schema drift pauses writes and alerts rather than creating malformed
items.

## Release Boundary

Monday migrations start after `043`. New tables and RPCs use RLS, revoked browser
privileges, fixed `search_path`, and service-role-only execution. The current
ordinary production migration policy cannot deploy the full RPC/RLS change set;
the implementation requires a separately reviewed migration path rather than
bypassing release controls.

The worker remains disabled until unit, database, HTTP release-proof, deletion,
retention, consent-race, stale-claim, lost-acknowledgement, schema-drift, and live
canary tests pass and BD accepts the board as its operating surface.
