# Monday CRM Projection Runbook

## Current State

The Monday projection is disabled. `MONDAY_UPSERT_ENABLED` and
`MONDAY_CLEANUP_ENABLED` must remain `false` until every release gate below is
approved.

The protected production release gate reads the deployed Vercel configuration and
fails unless both values are exactly `false`. Missing values also fail. This check
is a hold, not authorization to enable either lane. The pending authentication
approval and revocation drill remain independent blockers, and a successful local
test, release proof, schema check, or canary cannot substitute for them.

Record Monday release evidence against the same immutable SHA used by the five
discipline reviews. Evidence may include only the approved case references,
migration versions, schema fingerprint outcome, canary timestamps, and boolean
create/update/lookup/scrub/delete outcomes. Never attach item payloads, names,
emails, tokens, raw provider errors, or board responses. Run the real canary only
after protected approval; do not run it merely to complete local release proof.

Protected migration `058` is required before application release. It permits
deletion of a provably unsent local projection while both Monday lanes remain
disabled. It never treats a send, synced receipt, unknown delivery, conflict,
failure, or provider item ID as local-only; those states retain the provider
cleanup and verification path.

Protected migration `059` is the compatibility phase: it lets the old client
continue using an affirmative `1.1` analysis grant while returning `false` so the
new client rejects it. Promotion then applies or verifies strict migration `060`
before promoted smoke; `060` requires `1.2` analysis, human-contact, and
producer-transfer consent at the database boundary. Neither migration upgrades or
backfills historical `1.1` grants.

## Migration Map

The protected CRM migration set is exactly `044` CRM aggregate, `047` atomic
approval, `048` sync state machine, `049` lifecycle, `052` scheduler health, and
`053` bounded reconciliation. Legacy migrations `045`, `046`, `050`, and `051`
are not CRM migrations and the CRM runner never selects or applies them.

Run the protected workflow from `main` with an immutable commit SHA and the
`production-crm-migrations` environment approval. It validates LF-normalized
source hashes, takes the shared advisory lock, requires baseline `043` and its
schema signatures, and records only the approved CRM versions. Use
`node scripts/apply-production-crm-migrations.mjs --dry-run` for a local policy
check only; do not apply production migrations from a workstation. The workflow
uses `SUPABASE_ACCESS_TOKEN` only as its protected
`production-crm-migrations` environment secret and executes the checked-in SQL
artifact through the Supabase Management API, not a direct database URL. It
creates its ephemeral project link through the official Supabase CLI rather
than writing CLI metadata directly.

On 2026-07-15, the provisioner verified account `3603500`, workspace
`7318184`, private board `18421762586`, and service-user access. It created the
`crm_record_id` and `approved_revision` columns, removed legacy required
`session_id`, `contact_name`, and `contact_email` columns, and made only
`crm_record_id` and qualification status required. Sparse name-only and
email-only test records were created and deleted successfully.

Run a read-only check with:

```powershell
node --env-file="D:\Development Projects\Balance-Assist\.env" scripts/provision-monday-schema.mjs
```

Use `--apply` only for the reviewed idempotent remediation. The script refuses
column replacement and does not recreate status labels.

## Consent And Data Boundary

`CONSENT_VERSION` is `1.2`. The notice explicitly names Balance team, Telegram,
and Monday.com before producer transfer. Historical grants on version `1.0` do
not authorize a Monday projection.

Only the approved CRM snapshot may be projected. Never send analysis-only files,
filenames, object keys, extracted text, Telegram identifiers, AI-consent history,
raw acquisition metadata, raw provider errors, or tokens. Contact name and email
are independently nullable. Do not fabricate missing contact data.

## Authentication Gate

The initial single-board release uses a dedicated service-user personal token
only after a dated security exception is recorded. Before enabling either lane,
record the approval reference in `MONDAY_AUTH_APPROVAL_REF` and attach evidence
of the account/user/board scope, rotation owner, overlap procedure, and a tested
revocation drill.

The approval reference is currently pending. OAuth 2.1 is required instead if
the exception is not approved.

This is an unresolved external release gate: the integration must remain
fail-closed until a dated approval identifier is recorded here and matches
`MONDAY_AUTH_APPROVAL_REF`. Do not invent or substitute an approval reference.

## Retention Gate

Approved by Benjamin on 2026-07-15: `BA-CRM-RETENTION-2026-07-15`.
Qualified reviews are due 90 days after approval, then have a 30-day overdue
grace period. `needs_review`, `misfit`, and `unqualified` records have 30-day
terminal retention. The operator SLA is one business day.

The personal-token exception `BA-MONDAY-TOKEN-2026-07-15` is recorded as pending
a revocation drill. It does not authorize writes: `MONDAY_UPSERT_ENABLED` and
`MONDAY_CLEANUP_ENABLED` remain `false`.

## Deletion And DSRs

Explicit deletion must scrub the item name and every PII-bearing source column,
verify the scrub, then delete the item. Monday Trash can retain deleted data for
30 days. A verified DSR requiring earlier permanent erasure must use the
documented Monday/provider escalation path; local deletion is not complete until
 that external obligation is resolved.

## Reconciliation And Unknown Delivery

The weekly `monday-reconcile` workflow reads one bounded board page and persists
only a cursor checkpoint. It never writes to Monday. It adopts a single verified
active item by opaque CRM ID, records duplicate keys as terminal conflicts, and
queues a revision repair for inactive, missing, or source-field-drift items. A
five-minute recent-write grace period prevents a fresh receipt from being treated
as missing. Continue a partial scan by rerunning the workflow; do not reset the
checkpoint or manually recreate an unknown create.

Unknown creates are recovered in every `monday-dispatch` cycle by exact-key
lookup. An empty lookup is not deletion evidence and never authorizes a recreate.
Resolve duplicates through the Monday UI and record the audited operator case
reference before replaying the dispatch workflow. Do not place names, emails,
payloads, tokens, or raw provider errors in incident notes.

## Release Canary

The `Monday CRM canary` workflow is manually dispatched from `main` and requires
the protected `production` environment plus the exact confirmation text. It does
not apply migrations or change `MONDAY_UPSERT_ENABLED` or
`MONDAY_CLEANUP_ENABLED`; both are explicitly held at `false`. It verifies the
live schema fingerprint and recorded CRM migrations `044`, `047`, `048`, `049`,
`052`, and `053`, then creates, updates, looks up, scrubs, and deletes one item
with an opaque random CRM ID. Cleanup runs in `finally` even after a failed
assertion. The uploaded evidence contains only timestamps, migration versions,
and boolean outcomes.

The canary database prerequisite is separate from the CRM migration route and
its protected Management API credential.

For a reviewed local invocation, use the root environment file:

```powershell
node --env-file="D:\Development Projects\Balance-Assist\.env" scripts/run-monday-canary.mjs --execute
```

Do not run it until the release order is approved: deploy with both lanes off,
canary cleanup, run this full canary, obtain BD and privacy approval, and only
then enable the cleanup lane followed by upserts through the approved deployment
process.
