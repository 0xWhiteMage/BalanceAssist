# Monday CRM Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Project explicitly approved, versioned Balance Assist leads into Monday through a consent-aware durable outbox without blocking users or overwriting BD-owned CRM fields.

**Architecture:** Explicit approval atomically creates a durable CRM lead revision and a Monday sync obligation alongside the existing Telegram obligation. A scheduled authenticated worker uses leases, provider idempotency, schema attestation, receipts, reconciliation, and durable deletion to maintain Monday as a one-way operational projection while temporary session data still expires after 24 hours.

**Tech Stack:** Next.js 15, TypeScript, Supabase/PostgreSQL, Supabase service-role RPCs, Monday GraphQL API `2026-07`, GitHub Actions, Vitest, Playwright.

---

## Orchestration

Use a dedicated worktree created from current `main`. Execute database and Monday-client work in parallel only after Task 1 freezes the external contract.

```text
Task 1: governance and board contract
  +-> Task 2: CRM domain snapshot and payload builder
  +-> Task 3: Monday API client and schema verifier
  +-> Task 4: durable CRM schema

Task 4 -> Task 5: atomic approval revisions
Task 4 -> Task 6: leased Monday state machine
Task 5 + Task 6 -> Task 7: worker route
Task 5 + Task 6 -> Task 8: consent, deletion, and retention
Task 6 + Task 7 + Task 8 -> Task 9: scheduler and health
Task 3 + Task 6 + Task 8 + Task 9 -> Task 10: reconciliation
Task 4..10 -> Task 11: protected production migration path
Task 5 + Task 7 -> Task 12: approval/reapproval UX
Task 7..12 -> Task 13: release proof and canary
```

Recommended agent ownership:

| Workstream | Scope |
|---|---|
| Database | Tasks 4, 5, 6, 8, 11 |
| Monday API | Tasks 2, 3, 7, 10 |
| Product/UI | Task 12 |
| Operations | Tasks 1, 9, 11, 13 |
| Adversarial review | Review after Tasks 6, 8, and 13 |

Do not parallelize agents that edit the same migration, worker route, or finalization contract. Run spec review and code-quality review after every task.

## Task 1: Freeze the Board, Privacy, and Retention Contract

**Files:**
- Create: `config/monday-crm-schema.json`
- Create: `docs/monday-crm-runbook.md`
- Create: `tests/monday/schema-contract.test.ts`
- Create: `scripts/provision-monday-schema.mjs`
- Create: `tests/monday/schema-provisioning.test.ts`
- Modify: `lib/privacy/notice.ts`
- Modify: `lib/api/client.ts`
- Modify: `components/widget/attachment-dropzone.tsx`
- Modify: `tests/privacy/session-consent.test.ts`
- Modify: `tests/widget/attachment-dropzone.test.tsx`
- Modify: `tests/api/chat-client.test.ts`
- Modify: `tests/api/project-consent.test.ts`
- Modify: `tests/widget/data-use-notice.test.tsx`
- Modify: `tests/integration/release-proof-http.test.ts`
- Modify: `tests/integration/release-proof-journey.test.ts`
- Modify: `.env.example`

**Step 1: Record the release-blocking decisions**

Write the runbook with these explicit decisions:

- Monday.com CRM is explicitly named in the producer-transfer notice before any
  Monday disclosure. Bump `CONSENT_VERSION`; historical grants authorize the
  existing Balance-team/Telegram transfer only and never create Monday work.
- Analysis-only files never leave private Supabase Storage.
- Contact name and email are nullable; the board must not require both.
- `crm_record_id`, qualification status, and item name are the only required source fields.
- BD and privacy owners must approve and date a finite review cadence for every
  active lead plus finite terminal retention periods. Qualified opportunities
  may persist while actively renewed, but no record may remain indefinitely
  without a documented review. Approve a finite overdue grace period after which
  an unrenewed record automatically enters deletion. Record durations, grace,
  approvers, and operator SLA before Task 5; no implementation default is implied.
- Explicit deletion first scrubs the item name and every PII-bearing source
  column, verifies the scrub, then calls `delete_item`. Document Monday's
  residual 30-day Trash retention and the manual/provider DSR path for immediate
  permanent erasure.
- Freeze one production authentication path. For the initial single-board
  release, use a dedicated service-user personal token only after a dated
  security exception records account/user/board access, rotation owner,
  overlap procedure, and revocation drill. OAuth 2.1 is a separate required
  task if that exception is not approved.

**Step 2: Remediate the live board before coding**

Create an idempotent provisioning script that defaults to dry-run and requires
`--apply` for mutations. It must:

- Verify account ID, workspace ID, board ID, board kind, and service-user access.
- Remove the obsolete requirement for both `contact_name` and `contact_email`.
- Create or validate `crm_record_id` as the external key.
- Create or validate every source-owned column ID and type.
- Read root-level `validations(id: $boardId, type: board)` and prove sparse name-only and
  email-only records are accepted.
- Record status label IDs rather than depending on label text.
- Refuse destructive column replacement or label recreation without an
  explicit operator confirmation.

Do not proceed to Tasks 2-13 until the dry-run is empty and a sparse create/delete
canary succeeds for both contact variants.

**Step 3: Write the failing schema-contract test**

```ts
import schema from '../../config/monday-crm-schema.json';

test('separates source-owned and Monday-owned columns', () => {
  expect(schema.apiVersion).toBe('2026-07');
  expect(schema.externalKeyColumn).toBe('crm_record_id');
  expect(schema.accountId).toMatch(/^\d+$/);
  expect(schema.workspaceId).toMatch(/^\d+$/);
  expect(schema.requiredSourceColumns).toEqual([
    'crm_record_id',
    'qualification_status',
  ]);
  expect(schema.sourceOwnedColumns).not.toContain('lead_owner');
  expect(schema.sourceOwnedColumns).not.toContain('pipeline_stage');
  expect(schema.sourceOwnedColumns).not.toContain('next_follow_up');
  expect(Object.keys(schema.columns)).toEqual(expect.arrayContaining(schema.sourceOwnedColumns));
  expect(schema.statusLabelIds.qualification_status).toEqual(expect.objectContaining({
    qualified: expect.any(Number),
    needs_review: expect.any(Number),
    misfit: expect.any(Number),
    unqualified: expect.any(Number),
  }));
});
```

**Step 4: Run the test to verify it fails**

Run: `npm test -- tests/monday/schema-contract.test.ts`

Expected: FAIL because the checked-in schema contract does not exist.

**Step 5: Add the schema contract**

Use this shape and fill label IDs from the live board inspection; do not put tokens in the file:

```json
{
  "schemaVersion": 1,
  "apiVersion": "2026-07",
  "accountId": "<verified-account-id>",
  "workspaceId": "7318184",
  "boardId": "18421762586",
  "boardKind": "private",
  "externalKeyColumn": "crm_record_id",
  "requiredSourceColumns": ["crm_record_id", "qualification_status"],
  "sourceOwnedColumns": [
    "crm_record_id", "contact_name", "contact_email", "company",
    "service", "project_type", "project_scope", "timeline", "budget",
    "qualification_status", "lead_score", "recommended_next_step",
    "source_channel", "approved_at", "approved_revision", "reference_links"
  ],
  "mondayOwnedColumns": [
    "lead_owner", "pipeline_stage", "next_follow_up", "last_contacted",
    "meeting_booked", "meeting_outcome", "sales_notes", "loss_reason"
  ],
  "columns": {
    "crm_record_id": { "id": "crm_record_id", "type": "text" }
  },
  "statusLabelIds": {
    "qualification_status": {
      "qualified": 0,
      "needs_review": 1,
      "misfit": 2,
      "unqualified": 3
    },
    "recommended_next_step": {},
    "service": {},
    "budget": {},
    "source_channel": {},
    "initial_stage": {}
  },
  "validationsFingerprint": "<sha256>"
}
```

Empty column maps, placeholder IDs, unverified validations, or a missing label ID
for any enum value the projection can emit must fail tests.

**Step 6: Version the Monday-inclusive consent**

Update the user-facing notice and every caller that records consent. Add tests
that an old notice version cannot authorize Monday enqueue and that the exact
Monday-inclusive version is persisted in the approved revision and checked again
at send reservation.

**Step 7: Add environment placeholders**

Add only names and safe defaults:

```dotenv
MONDAY_API_TOKEN=
MONDAY_BOARD_ID=18421762586
MONDAY_API_VERSION=2026-07
MONDAY_UPSERT_ENABLED=false
MONDAY_CLEANUP_ENABLED=false
MONDAY_AUTH_MODE=service_token
MONDAY_AUTH_APPROVAL_REF=
```

**Step 8: Run and commit**

Run: `npm test -- tests/monday/schema-contract.test.ts tests/monday/schema-provisioning.test.ts tests/privacy/session-consent.test.ts`

Expected: PASS after the live board contract contains real column and label IDs.

```bash
git add config/monday-crm-schema.json docs/monday-crm-runbook.md tests/monday/schema-contract.test.ts scripts/provision-monday-schema.mjs tests/monday/schema-provisioning.test.ts lib/privacy/notice.ts lib/api/client.ts components/widget/attachment-dropzone.tsx tests/privacy/session-consent.test.ts tests/widget/attachment-dropzone.test.tsx tests/api/chat-client.test.ts tests/api/project-consent.test.ts tests/widget/data-use-notice.test.tsx tests/integration/release-proof-http.test.ts tests/integration/release-proof-journey.test.ts .env.example
git commit -m "docs: freeze Monday CRM projection contract"
```

## Task 2: Define the Approved CRM Snapshot and Payload Allowlists

**Files:**
- Create: `lib/monday/projection.ts`
- Create: `tests/monday/projection.test.ts`
- Modify: `lib/conversation/draft-schema.ts`

**Step 1: Write failing projection tests**

Cover nullable contact fields, current hyphenated enum values, truncation, URL filtering, and strict ownership:

```ts
test('never includes Monday-owned or analysis-only data in an update', () => {
  const payload = buildMondayUpdatePayload(approvedSnapshotFixture);
  expect(payload).not.toHaveProperty('lead_owner');
  expect(payload).not.toHaveProperty('pipeline_stage');
  expect(payload).not.toHaveProperty('reference_files');
  expect(JSON.stringify(payload)).not.toContain('object_key');
  expect(JSON.stringify(payload)).not.toContain('telegram');
});

test('preserves missing email instead of fabricating it', () => {
  const payload = buildMondayCreatePayload({
    ...approvedSnapshotFixture,
    contactEmail: null,
  });
  expect(payload).not.toHaveProperty('contact_email');
});
```

**Step 2: Run to verify failure**

Run: `npm test -- tests/monday/projection.test.ts`

Expected: FAIL because the projection module does not exist.

**Step 3: Implement the versioned snapshot schema**

Export a Zod schema with this logical shape:

```ts
export const approvedCrmSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  crmRecordId: z.string().uuid(),
  approvedRevision: z.number().int().positive(),
  approvedDraftVersion: z.number().int().nonnegative(),
  approvedAt: z.string().datetime(),
  producerTransferNoticeVersion: z.string().min(1),
  producerTransferRecordedAt: z.string().datetime(),
  contactName: z.string().max(500).nullable(),
  contactEmail: z.string().email().nullable(),
  company: z.string().max(500).nullable(),
  service: z.string().max(200).nullable(),
  projectType: z.string().max(500).nullable(),
  projectScope: z.string().max(2_000).nullable(),
  timeline: z.string().max(500).nullable(),
  budget: z.string().max(500).nullable(),
  qualificationStatus: z.enum(['qualified', 'needs_review', 'misfit', 'unqualified']),
  score: z.number().int().min(0),
  recommendedNextStep: z.enum(['schedule', 'manual_review', 'redirect', 'human_followup']),
  referenceLinks: z.array(z.object({ url: publicReferenceUrlSchema, label: z.string().max(254).nullable() })).max(20),
});
```

`publicReferenceUrlSchema` accepts normalized public `https:` URLs only. Reject
credentials, fragments, localhost/private-network hosts, signed URLs, and
sensitive query parameters. Sort normalized links before hashing or projection.

**Step 4: Implement separate create and update builders**

Use canonical Monday value shapes:

```ts
contact_email: snapshot.contactEmail
  ? { email: snapshot.contactEmail, text: snapshot.contactName ?? snapshot.contactEmail }
  : undefined,
project_scope: snapshot.projectScope ? { text: snapshot.projectScope.slice(0, 2_000) } : undefined,
qualification_status: { index: schema.statusLabelIds.qualification_status[snapshot.qualificationStatus] },
```

Remove `undefined` keys. The create builder may set the initial stage only when the schema contract defines an approved initial-stage label. The update builder must never contain a Monday-owned column.
Every enum builder must use its column-specific label map and throw before any
provider call when an emitted value lacks a numeric label ID. Test every allowed
qualification, recommendation, service, budget, source-channel, and initial-stage
value.

Derive the item name inside this module as `Balance Assist - <service or project
type> - <short CRM ID>`, falling back to `Balance Assist - <short CRM ID>` and
capping it to Monday's 255-character limit. Do not put contact, company, scope,
or email in the item name. Add empty/oversized input tests.

**Step 5: Run tests and commit**

Run: `npm test -- tests/monday/projection.test.ts tests/conversation/draft-schema.test.ts`

Expected: PASS.

```bash
git add lib/monday/projection.ts tests/monday/projection.test.ts lib/conversation/draft-schema.ts
git commit -m "feat: define approved Monday projection contract"
```

## Task 3: Implement a Strict Monday GraphQL Client and Schema Attestation

**Files:**
- Create: `lib/monday/client.ts`
- Create: `lib/monday/config.ts`
- Create: `tests/monday/client.test.ts`
- Create: `scripts/verify-monday-schema.mjs`
- Modify: `package.json`

**Step 1: Write failing client tests**

Test all provider boundaries:

- Raw token in `Authorization`.
- `API-Version: 2026-07`.
- Ten-second timeout.
- Root-level `items_page_by_column_values` with `limit: 2`.
- HTTP 200 plus `errors` is failure.
- `data: null` is never absence.
- Mutation alias must return a nonempty item ID.
- Top-level `extensions.request_id` and any error extension request ID are
  parsed; `Retry-After`, `RateLimit`,
  `RateLimit-Policy`, effective `API-Version`, and `Idempotency-Replayed` are
  parsed from headers.
- Create/update/delete use `Idempotency-Key`.
- HTTP 409 provider idempotency conflicts are retryable after `Retry-After` and
  remain distinct from terminal duplicate-business-key conflicts.
- HTTP 400, 401, 403, 409, 422, 423, 429, and 5xx are categorized explicitly.

```ts
expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
  Authorization: 'test-token',
  'API-Version': '2026-07',
});
expect(requestBody.query).toContain('items_page_by_column_values');
expect(requestBody.query).toContain('board_id: $boardId');
expect(requestBody.query).not.toContain('boards(ids:');
```

**Step 2: Run to verify failure**

Run: `npm test -- tests/monday/client.test.ts`

Expected: FAIL because the client does not exist.

**Step 3: Implement configuration and error categories**

Expose:

```ts
type MondayFailureCode =
  | 'monday_auth_failed'
  | 'monday_permission_denied'
  | 'monday_rate_limited'
  | 'monday_schema_drift'
  | 'monday_payload_invalid'
  | 'monday_temporary_failure'
  | 'monday_provider_idempotency_conflict'
  | 'monday_delivery_unknown'
  | 'monday_duplicate_key_conflict';
```

Configuration must fail closed when either lane is enabled without token, board
ID, supported API version, and the Task 1 authentication evidence. Parse
`MONDAY_UPSERT_ENABLED` and `MONDAY_CLEANUP_ENABLED` from the exact strings
`true` and `false`; do not use `z.boolean()` on environment strings. Cleanup can
be enabled before upserts and must remain available if upserts are paused.
Require `MONDAY_AUTH_MODE=service_token` and a nonempty safe
`MONDAY_AUTH_APPROVAL_REF` matching the checked-in runbook approval identifier;
never treat the approval reference as a secret or token.

**Step 4: Implement provider operations**

Export:

```ts
findItemsByCrmRecordId(crmRecordId, fetchImpl)
getMondayItemById(itemId, fetchImpl)
scanMondayBoardPage(cursor, fetchImpl)
createMondayItem(itemName, columnValues, requestKey, fetchImpl)
updateMondayItem(itemId, columnValues, requestKey, fetchImpl)
deleteMondayItem(itemId, requestKey, fetchImpl)
verifyMondaySchema(expectedSchema, fetchImpl)
verifyMondayCleanupSchema(expectedSchema, fetchImpl)
```

Only a validated empty `items` array returns `[]`. Any malformed shape throws a categorized error. `getMondayItemById` must include inactive items and return board ID, active/archived/deleted state, and external-key value so every update, scrub, or delete can verify board and identity first. Schema queries must pass an explicit `capabilities` argument and query root-level board validations. Never include raw response content, payload values, or tokens in thrown messages.

Full upsert attestation verifies every projected column and enum. The separate
cleanup attestation verifies board identity, external-key column, item-name
mutation, and every PII-bearing source column that must be cleared. If cleanup
attestation fails, defer local deletion and invoke the documented manual/provider
DSR path; never report deletion complete.

**Step 5: Add the read-only verifier script**

Add `monday:schema:verify` to `package.json`. The script prints only board ID, effective API version, fingerprint, and mismatched column IDs/types. It must never print token or full board values.

**Step 6: Run and commit**

Run: `npm test -- tests/monday/client.test.ts`

Run: `npm run lint && npx tsc --noEmit`

Expected: PASS.

```bash
git add lib/monday/client.ts lib/monday/config.ts tests/monday/client.test.ts scripts/verify-monday-schema.mjs package.json
git commit -m "feat: add strict Monday GraphQL client"
```

## Task 4: Add the Durable CRM Aggregate and Projection Outbox

**Files:**
- Create: `supabase/migrations/044_monday_crm_projection_tables.sql`
- Modify: `tests/integration/database-schema.test.ts`
- Create: `tests/privacy/monday-crm-migration.test.ts`

**Step 1: Write failing schema tests**

Require these tables and protections:

```sql
public.crm_leads
public.crm_lead_revisions
public.monday_sync_outbox
```

Assert RLS is enabled, `PUBLIC`, `anon`, and `authenticated` have no privileges, all state columns have constraints, and PII snapshots exist only in `crm_lead_revisions.payload`.

**Step 2: Run to verify failure**

Run: `npm test -- tests/privacy/monday-crm-migration.test.ts`

Expected: FAIL because migration 044 does not exist.

**Step 3: Create migration 044**

Use this minimum schema:

```sql
CREATE TABLE public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_session_id uuid UNIQUE REFERENCES public.sessions(id) ON DELETE SET NULL,
  lead_id bigint UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL,
  desired_revision integer NOT NULL DEFAULT 0 CHECK (desired_revision >= 0),
  applied_revision integer NOT NULL DEFAULT 0 CHECK (applied_revision >= 0),
  lifecycle_state text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'review_overdue', 'deletion_requested', 'deleted', 'expired')),
  monday_item_id text,
  review_due_at timestamptz NOT NULL,
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (applied_revision <= desired_revision)
);

CREATE TABLE public.crm_lead_revisions (
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  source_draft_version integer NOT NULL CHECK (source_draft_version >= 0),
  approval_input_hash text NOT NULL CHECK (approval_input_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz NOT NULL,
  consent_notice_version text NOT NULL,
  consent_recorded_at timestamptz NOT NULL,
  PRIMARY KEY (crm_lead_id, revision),
  UNIQUE (crm_lead_id, approval_input_hash)
);

CREATE TABLE public.monday_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision >= 0),
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending', 'claiming', 'sending', 'synced', 'delivery_unknown',
    'conflict', 'failed', 'suppressed'
  )),
  provider_operation text CHECK (provider_operation IN ('create', 'update', 'scrub', 'delete')),
  target_item_id text,
  frozen_payload_hash text CHECK (frozen_payload_hash IS NULL OR frozen_payload_hash ~ '^[0-9a-f]{64}$'),
  item_name text CHECK (item_name IS NULL OR length(item_name) BETWEEN 1 AND 255),
  request_key uuid NOT NULL DEFAULT gen_random_uuid(),
  claim_token uuid,
  claim_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  provider_request_id text CHECK (provider_request_id IS NULL OR length(provider_request_id) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crm_lead_id, revision, operation)
);
```

Add due-row, lease-expiry, lifecycle-retention, and item-receipt indexes. Enable RLS and revoke browser/public privileges on every table.

Add a partial unique index allowing at most one actively executing provider
mutation per CRM aggregate across `claiming` and `sending`. Multiple pending
obligations are allowed so a reapproval or deletion barrier can supersede earlier
work; aggregate locking and claim priority serialize execution. Delivery-unknown
upserts block later execution through claim predicates until positively resolved.
Provider intent fields freeze one exact GraphQL mutation and one exact
`Idempotency-Key`; changing create/update/scrub/delete intent must atomically
generate a new request key. Superseded revision payloads must be removed after
they can no longer be retried. Never retain a payload hash as a supposedly
PII-free deletion tombstone.

**Step 4: Run database tests**

Run: `npm test -- tests/privacy/monday-crm-migration.test.ts`

Run with disposable database: `npm run test:db:prepare && npm run test:db`

Expected: PASS.

**Step 5: Commit**

```bash
git add supabase/migrations/044_monday_crm_projection_tables.sql tests/integration/database-schema.test.ts tests/privacy/monday-crm-migration.test.ts
git commit -m "feat: add durable Monday CRM projection schema"
```

## Task 5: Make Approval Revision and CRM Enqueue Atomic

**Files:**
- Create: `supabase/migrations/045_atomic_crm_approval.sql`
- Modify: `app/api/leads/finalize/route.ts`
- Modify: `lib/api/contracts.ts`
- Modify: `tests/api/leads-finalize.test.ts`
- Modify: `tests/integration/database-schema.test.ts`

**Step 1: Write failing database tests**

Cover:

- First approval creates lead, CRM aggregate, revision 1, Monday outbox row, and Telegram outbox row atomically.
- Double submission of the same draft version does not create a second revision.
- Concurrent approvals of the same canonical input create one revision.
- A reference-link-only change creates a new revision only after explicit approval.
- Explicit approval after a changed draft creates revision 2 and one new Monday obligation.
- No producer-transfer consent creates no CRM record.
- A producer-transfer grant on the historical pre-Monday notice version creates no CRM record.
- `deletion_state <> 'active'` creates no CRM record.
- Snapshot values come from canonical `sessions.draft`, never the browser body.
- Revision payload excludes private files and Telegram metadata.

**Step 2: Run to verify failure**

Run: `npx vitest run --no-file-parallelism tests/integration/database-schema.test.ts`

Expected: FAIL because finalization does not create CRM revisions.

**Step 3: Create forward migration 045**

Drop and recreate `finalize_session_lead(uuid)` in a forward migration; PostgreSQL
cannot change its table return type with `CREATE OR REPLACE FUNCTION`. Do not edit
migration 036. Immediately restore revoked `PUBLIC`, `anon`, and `authenticated`
execution and grant only `service_role`. Add an upgrade test that applies 045 to a
real schema already at 044. The function must:

- Follow one global lock order everywhere: source session when present, CRM
  aggregate, then outbox row. Never hold an outbox lock while waiting for either
  parent lock.
- Require `deletion_state = 'active'`.
- Select the latest producer-transfer consent row and timestamp and require the
  exact Monday-inclusive notice version.
- Calculate qualification from canonical draft.
- Insert or update the current `leads` snapshot for explicit reapproval.
- Insert or find `crm_leads` by source session.
- Read at most 20 approved rows from `public.reference_links` in deterministic
  normalized URL order. Apply the public-HTTPS URL policy and map `kind` to the
  nullable label.
- Compute `approval_input_hash` over canonical draft version plus the ordered
  approved-link set, excluding approval timestamps and revision metadata.
- Use the unique approval-input hash to make duplicate and concurrent approvals
  return the existing revision.
- Build the approved snapshot server-side.
- Hash `payload::text` with SHA-256.
- Insert one `monday_sync_outbox` upsert row for the new revision.
- Set non-null `review_due_at` from the approved review cadence on every approval
  and reapproval. Set `retention_expires_at` only when the approved lifecycle
  state has a terminal expiry; active qualified opportunities require explicit
  periodic renewal rather than silent indefinite retention or automatic deletion.
- Preserve existing Telegram behavior unless a separate business decision approves revision notifications.

Return `crm_record_id`, `crm_revision`, `approved_draft_version`, and `crm_queued`
alongside existing fields.

**Step 4: Extend the route response safely**

The request remains `{sessionId}` only. Add response fields without accepting CRM or qualification values from the browser.

**Step 5: Run tests and commit**

Run: `npm test -- tests/api/leads-finalize.test.ts`

Run: `npm run test:db`

Expected: PASS.

```bash
git add supabase/migrations/045_atomic_crm_approval.sql app/api/leads/finalize/route.ts lib/api/contracts.ts tests/api/leads-finalize.test.ts tests/integration/database-schema.test.ts
git commit -m "feat: atomically approve CRM lead revisions"
```

## Task 6: Add Leased Monday Claims and Token-Guarded Completion

**Files:**
- Create: `supabase/migrations/046_monday_sync_state_machine.sql`
- Create: `lib/monday/outbox.ts`
- Create: `tests/monday/outbox.test.ts`
- Modify: `tests/integration/database-schema.test.ts`

**Step 1: Write failing state-machine tests**

Cover concurrent claims, lease expiry, stale tokens, reserve-before-send, current
revision selection, suppression after lifecycle change, delivery unknown,
conflict, retry, success, deletion barriers, and scrub-then-delete completion.
Include revision 1 completing after revision 2, revocation during `claiming` and
`sending`, and a late create result arriving after deletion was requested.

**Step 2: Run to verify failure**

Run: `npm test -- tests/monday/outbox.test.ts`

Expected: FAIL because Monday claim RPCs do not exist.

**Step 3: Create migration 046**

Add service-role-only RPCs:

```text
claim_next_monday_sync(p_lease_seconds integer default 120)
reserve_monday_sync_send(p_sync_id uuid, p_claim_token uuid)
complete_monday_sync_upsert(p_sync_id uuid, p_claim_token uuid, p_item_id text)
complete_monday_sync_scrub(p_sync_id uuid, p_claim_token uuid)
complete_monday_sync_delete(p_sync_id uuid, p_claim_token uuid)
mark_monday_sync_retry(p_sync_id uuid, p_claim_token uuid, p_code text, p_delay_seconds integer)
mark_monday_sync_unknown(p_sync_id uuid, p_claim_token uuid, p_code text)
mark_monday_sync_conflict(p_sync_id uuid, p_claim_token uuid)
```

The claim RPC first discovers a due candidate without retaining a row lock, then
acquires `FOR UPDATE SKIP LOCKED` locks in the global order: source session when
present, CRM aggregate, then outbox row. It must revalidate every claim predicate
after locking, loop if the candidate changed, recover expired `claiming` and
`sending` leases, select the exact revision payload, and serialize every provider
mutation for one CRM record.
Suppress unreserved obsolete revisions and require an upsert revision to equal
`desired_revision` at reservation. Reservation must recheck lifecycle and the
exact Monday-inclusive consent version when the source session still exists.
Claim predicates prioritize pending deletion barriers over pending upserts and
must refuse all later work while an earlier create is `delivery_unknown`.

Lease recovery must distinguish provider intent. An expired `sending` create, or
any create where the request may have reached Monday but no validated item ID was
committed, transitions to `delivery_unknown`; it never returns directly to
`pending`. Add crash tests for process loss immediately before the provider call,
after provider acceptance, and before database completion.

Before external I/O, reservation must freeze `provider_operation`, target item,
item name, payload hash, and a request key dedicated to that exact GraphQL
mutation. A changed decision creates a new provider intent and request key.

Completion must require matching state and claim token. Upsert completion always
records a returned item ID, including when deletion was requested while the call
was in flight; in that case it atomically queues the deletion barrier. It may
advance but never decrease `applied_revision`.

A delete cannot claim or complete while any earlier upsert is `claiming`,
`sending`, or `delivery_unknown`. Unknown delivery must first reconcile: adopt
one item and scrub/delete it or conflict on duplicates. Once a create mutation
was sent, elapsed time plus absence is never sufficient deletion evidence; require
an idempotency replay result, positive provider/audit evidence, or an operator
permanent-erasure confirmation. A deleted/Trash item requires the documented
restore-and-scrub or permanent-erasure path. Deletion uses two provider intents: scrub all
PII-bearing source columns and replace the item name with the opaque CRM key,
verify the scrub, then generate a new request key and call `delete_item`. Only
after both phases may the transaction delete all revision payloads and retain a
PII-free lifecycle tombstone.

**Step 4: Implement thin TypeScript wrappers**

Do not duplicate state transitions in route-level update calls. `lib/monday/outbox.ts` should call only the RPCs and validate result shapes.

**Step 5: Run and commit**

Run: `npm test -- tests/monday/outbox.test.ts`

Run: `npm run test:db`

Expected: PASS.

```bash
git add supabase/migrations/046_monday_sync_state_machine.sql lib/monday/outbox.ts tests/monday/outbox.test.ts tests/integration/database-schema.test.ts
git commit -m "feat: add leased Monday sync state machine"
```

## Task 7: Build the Authenticated Monday Dispatch Worker

**Files:**
- Create: `app/api/internal/monday-dispatch/route.ts`
- Create: `tests/api/monday-dispatch.test.ts`
- Modify: `lib/observability/events.ts`
- Modify: `tests/observability/events.test.ts`

**Step 1: Write failing route tests**

Cover:

- Missing internal auth returns 401 before provider access.
- Disabled integration returns a truthful 503.
- Full schema drift pauses upserts. The cleanup lane continues only when the
  independent cleanup-specific attestation passes; otherwise it defers and
  escalates to manual/provider DSR.
- Stored item ID is updated only after board ID, item state, and external key are verified.
- Missing item ID performs exact lookup before create.
- Valid empty lookup creates with one durable request key.
- One lookup item is adopted and updated.
- Multiple items enter conflict.
- Create timeout enters `delivery_unknown` without immediate re-create.
- Connection reset, 5xx, malformed response, or GraphQL failure after a create
  request may have been sent also enters `delivery_unknown`; only a provably
  pre-send failure may retry the create intent directly.
- `data: null` never creates.
- Delete operation resolves unknown creates, scrubs and verifies PII removal,
  then deletes by verified item ID.
- Cancellation after provider success but before database completion records
  unknown delivery and remains recoverable.
- Raw provider errors and PII never enter logs or database codes.

**Step 2: Run to verify failure**

Run: `npm test -- tests/api/monday-dispatch.test.ts`

Expected: FAIL because the route does not exist.

**Step 3: Implement the worker**

Follow `app/api/internal/handoff-dispatch/route.ts`:

- Authenticate with `CRON_SECRET` or `INTERNAL_DISPATCH_SECRET`.
- Require Supabase server config and enabled Monday config.
- Verify schema once before a bounded batch.
- Enforce an internal deadline below the scheduler's HTTP timeout. Stop claiming
  when there is not enough time for one provider request plus database completion;
  do not rely only on a fixed batch count.
- Run a bounded `delivery_unknown` recovery lane every dispatch cycle before new
  creates; weekly reconciliation is only the full-board backstop.
- Recheck eligibility through reservation immediately before provider mutation.
- Verify stored item board ID, active/archived/deleted state, and CRM external key
  before every update, scrub, or delete. Mismatch is a terminal duplicate-key
  conflict, never a write.
- Use the persisted request key for the exact request retry.
- Categorize provider errors into stable codes.
- Never log payloads, names, emails, URLs, tokens, or raw GraphQL errors.
- Persist only the sanitized Monday request ID from GraphQL error extensions.
- Keep cleanup enabled when new upserts are disabled; credential or permission
  loss must alert and route deletion to the documented manual/provider DSR path
  rather than silently completing local deletion.

**Step 4: Add allowlisted events**

Add:

```text
monday_sync_succeeded
monday_sync_failed
monday_sync_unknown
monday_sync_conflict
monday_sync_suppressed
monday_schema_drift
```

Allow only CRM record ID, sync ID, revision, duration, and stable reason codes.

**Step 5: Run and commit**

Run: `npm test -- tests/api/monday-dispatch.test.ts tests/observability/events.test.ts`

Run: `npm run lint && npx tsc --noEmit`

Expected: PASS.

```bash
git add app/api/internal/monday-dispatch/route.ts tests/api/monday-dispatch.test.ts lib/observability/events.ts tests/observability/events.test.ts
git commit -m "feat: dispatch approved leads to Monday"
```

## Task 8: Integrate Consent Revocation, Deletion, and Retention

**Files:**
- Create: `supabase/migrations/047_monday_crm_lifecycle.sql`
- Modify: `app/api/internal/deletion-worker/route.ts`
- Create: `app/api/internal/monday-lifecycle/route.ts`
- Create: `scripts/request-monday-dsr.mjs`
- Modify: `tests/api/deletion-worker.test.ts`
- Create: `tests/api/monday-lifecycle.test.ts`
- Modify: `tests/privacy/session-consent.test.ts`
- Modify: `docs/deletion-processing-runbook.md`

**Step 1: Write failing lifecycle tests**

Cover:

- Producer-transfer revocation suppresses unsent upserts.
- Revocation after sync queues a delete operation.
- Explicit deletion queues delete before session deletion can complete.
- Deletion waits while Monday cleanup or an earlier unknown upsert is unresolved.
- Missing external item completes automatically only when the create intent was
  never sent. Any sent/unknown create requires positive provider or operator
  erasure evidence.
- Expired unqualified/misfit/needs-review records queue deletion.
- Qualified records become review-due on the approved cadence but are not
  automatically deleted while BD has explicitly renewed them as active. At the
  due date they enter `review_overdue`; absent an audited renewal within the
  approved grace period, the lifecycle worker automatically queues deletion.
- Automatic 24-hour session expiry sets `source_session_id` to null but keeps approved CRM data.
- A verified privacy request after session expiry can queue deletion by opaque CRM
  record ID through the audited operator path.

**Step 2: Run to verify failure**

Run: `npm test -- tests/api/deletion-worker.test.ts tests/api/monday-lifecycle.test.ts tests/privacy/session-consent.test.ts`

Expected: FAIL because CRM lifecycle integration does not exist.

**Step 3: Create migration 047**

Forward-migrate these functions rather than editing recorded migrations:

- `record_session_consent(...)` to atomically suppress or delete CRM projection on producer-transfer revocation.
- `request_deletion_job(...)` to mark linked CRM records `deletion_requested` and queue delete work.
- `delete_session_for_deletion_job(...)` to refuse completion while CRM deletion is pending.
- A bounded `queue_expired_crm_leads(p_limit integer)` RPC.
- Service-role-only `renew_crm_lead_review(...)` and
  `expire_crm_lead(...)` RPCs with PII-free operator audit references.
- `request_crm_deletion_by_record_id(p_crm_record_id, p_audit_ref)` for the
  identity-verified post-session DSR path. It must be service-role-only, reject
  empty audit references, and never accept email/name as an unauthenticated key.
- A token-guarded `defer_deletion_job(p_job_id, p_lease_token,
  p_next_attempt_at)` RPC that releases the lease without counting expected
  external waiting as failure.
- A `next_attempt_at` column and claim predicate so one deferred CRM dependency
  cannot monopolize the deletion queue.

Backfill non-null `review_due_at` and any applicable terminal
`retention_expires_at` for CRM rows created before migration 047.
Remove superseded full revision payloads once they are no longer needed for
retry. Do not retain PII, payload hashes, or linkable contact fingerprints in
completed deletion jobs or lifecycle tombstones.

**Step 4: Update workers and documentation**

The deletion worker must call the defer RPC and return HTTP 200 with
`{status:"deferred"}` while Monday cleanup is unresolved; reserve 5xx for actual
worker failure. The lifecycle worker drains bounded pages of due retention work
until its internal deadline; the Monday dispatcher performs scrub/delete.
Document Monday's 30-day Trash retention and escalation path for permanent
provider erasure.
The DSR script requires an operator-supplied opaque CRM ID and PII-free approved
case reference, prints no CRM payload, and follows a runbook identity-verification
procedure before invocation.
The daily lifecycle workflow must surface every overdue record, enforce the
grace-period transition, and require renewal or expiry within the Task 1 operator
SLA; it is not an advisory report.

**Step 5: Run and commit**

Run: `npm test -- tests/api/deletion-worker.test.ts tests/api/monday-lifecycle.test.ts tests/privacy/session-consent.test.ts`

Run: `npm run test:db`

Expected: PASS.

```bash
git add supabase/migrations/047_monday_crm_lifecycle.sql app/api/internal/deletion-worker/route.ts app/api/internal/monday-lifecycle/route.ts scripts/request-monday-dsr.mjs tests/api/deletion-worker.test.ts tests/api/monday-lifecycle.test.ts tests/privacy/session-consent.test.ts docs/deletion-processing-runbook.md
git commit -m "feat: enforce Monday CRM lifecycle deletion"
```

## Task 9: Add Schedulers, Heartbeats, and Backlog Health

**Files:**
- Create: `supabase/migrations/048_monday_scheduler_health.sql`
- Create: `.github/workflows/monday-dispatch.yml`
- Create: `.github/workflows/monday-lifecycle.yml`
- Modify: `app/api/internal/scheduler-heartbeat/route.ts`
- Modify: `app/api/internal/scheduler-health/route.ts`
- Modify: `tests/api/scheduler-health.test.ts`
- Create: `tests/integration/monday-workflows.test.ts`

**Step 1: Write failing workflow and health tests**

Require both workers, authenticated calls, no cancellation of in-flight dispatch,
short timeouts, heartbeat only after success, per-worker freshness windows,
pending backlog age, unknown-delivery count, conflict/permanent-failure count,
expired-lease count, rate-budget pressure, schema-attestation state,
credential/permission health, and deletion backlog.

**Step 2: Run to verify failure**

Run: `npm test -- tests/api/scheduler-health.test.ts tests/integration/monday-workflows.test.ts`

Expected: FAIL because Monday workers are not registered.

**Step 3: Create migration 048**

Add `monday-dispatch` and `monday-lifecycle` to the heartbeat constraint and RPC allowlist. Extend `scheduler_health()` with:

```text
oldest_pending_monday_seconds
monday_delivery_unknown_count
monday_conflict_count
oldest_pending_monday_deletion_seconds
overdue_crm_review_count
oldest_overdue_crm_review_seconds
```

Use separate freshness thresholds: about 20 minutes for dispatch and more than 24
hours for the daily lifecycle worker. Health is false when pending work exceeds
15 minutes, unknown delivery exceeds its recovery window, terminal conflicts or
permission/schema incidents are unacknowledged, expired leases accumulate, or
deletion exceeds the documented SLA. Health also fails when overdue reviews
exceed the approved operator SLA or grace transition is not draining. Persist
only safe attestation/error codes.
Monday workers and backlogs must not make global health fail while both feature
lanes are intentionally disabled during rollout.

**Step 4: Add workflows**

Run dispatch every five minutes. Run lifecycle daily. Use `permissions: {}`, `cancel-in-progress: false`, `curl --fail`, 30-second HTTP timeout, and existing `CRON_SECRET`/`PRODUCTION_URL` secrets.

**Step 5: Run and commit**

Run: `npm test -- tests/api/scheduler-health.test.ts tests/integration/monday-workflows.test.ts`

Expected: PASS.

```bash
git add supabase/migrations/048_monday_scheduler_health.sql .github/workflows/monday-dispatch.yml .github/workflows/monday-lifecycle.yml app/api/internal/scheduler-heartbeat/route.ts app/api/internal/scheduler-health/route.ts tests/api/scheduler-health.test.ts tests/integration/monday-workflows.test.ts
git commit -m "ci: schedule and monitor Monday CRM sync"
```

## Task 10: Add Bounded Reconciliation and Unknown-Delivery Recovery

**Files:**
- Create: `supabase/migrations/049_monday_reconciliation.sql`
- Create: `app/api/internal/monday-reconcile/route.ts`
- Create: `.github/workflows/monday-reconcile.yml`
- Create: `tests/api/monday-reconcile.test.ts`
- Modify: `lib/monday/client.ts`
- Modify: `lib/monday/outbox.ts`
- Modify: `app/api/internal/scheduler-heartbeat/route.ts`
- Modify: `app/api/internal/scheduler-health/route.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/integration/monday-workflows.test.ts`
- Modify: `docs/monday-crm-runbook.md`

**Step 1: Write failing reconciliation tests**

Cover paginated board reads, stored-ID validation, exact-key recovery, duplicates, missing items, source-field drift, archived/deleted items, recent-write grace period, API budget, and checkpoint continuation.

**Step 2: Run to verify failure**

Run: `npm test -- tests/api/monday-reconcile.test.ts`

Expected: FAIL because reconciliation does not exist.

**Step 3: Add durable reconciliation primitives**

Migration 049 adds a protected checkpoint table and service-role-only RPCs for
claiming a page, recording a cursor, adopting a verified item ID, enqueueing a
repair revision, and terminally recording duplicate-key conflicts. Extend the
heartbeat allowlists with `monday-reconcile` using a freshness threshold greater
than one week. Route code must not mutate control tables directly.

**Step 4: Implement read-mostly reconciliation**

Use the paginated board methods added to `lib/monday/client.ts` and one board scan
per run, keyed by CRM record ID. Do not issue one search call per local row.
Reconciliation may enqueue repair work through RPCs but must not directly mutate
Monday or tables. Weekly reconciliation handles full drift; bounded unknown-create
recovery remains in every dispatch cycle. An unknown create is never automatically
abandoned and recreated merely because Monday's idempotency cache expired.

**Step 5: Add weekly workflow and runbook**

The workflow uses the same internal auth and records a heartbeat only when a reconciliation heartbeat is added to the schema. Document conflict resolution and replay commands without exposing PII.

**Step 6: Run and commit**

Run: `npm test -- tests/api/monday-reconcile.test.ts tests/integration/monday-workflows.test.ts`

Expected: PASS.

```bash
git add supabase/migrations/049_monday_reconciliation.sql app/api/internal/monday-reconcile/route.ts .github/workflows/monday-reconcile.yml tests/api/monday-reconcile.test.ts lib/monday/client.ts lib/monday/outbox.ts app/api/internal/scheduler-heartbeat/route.ts app/api/internal/scheduler-health/route.ts tests/integration/database-schema.test.ts tests/integration/monday-workflows.test.ts docs/monday-crm-runbook.md
git commit -m "feat: reconcile Monday CRM projections"
```

## Task 11: Add a Reviewed Production Migration Path

**Files:**
- Create: `scripts/apply-production-crm-migrations.mjs`
- Create: `supabase/production-monday-crm-044-049.sql`
- Create: `.github/workflows/production-crm-migrations.yml`
- Create: `tests/integration/production-crm-migration-policy.test.ts`
- Modify: `scripts/apply-production-migrations.mjs`
- Modify: `scripts/apply-production-cleanup-migrations.mjs`
- Modify: `tests/integration/production-migration-policy.test.ts`
- Modify: `tests/integration/production-cleanup-migration-policy.test.ts`
- Modify: `.github/workflows/production-release.yml`
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Write failing migration-policy tests**

Require exactly versions 044-049, exact filenames, SHA-256 source pins normalized
to LF, no later migration, source-identical SQL Editor bundle sections, baseline
043 and schema-signature guards inside the transaction, a shared PostgreSQL
advisory lock, exact tracker inserts, and protected environment approval. Add
old-app/new-database and new-app/old-database compatibility tests.

**Step 2: Run to verify failure**

Run: `npm test -- tests/integration/production-crm-migration-policy.test.ts`

Expected: FAIL because the reviewed path does not exist.

**Step 3: Implement the protected runner**

Mirror `apply-production-cleanup-migrations.mjs` but use a separate allowlist and
environment named `production-crm-migrations`. The runner must reject changed
hashes, renamed files, missing versions, or any version after 049. It must take
the same advisory lock as the SQL Editor artifact and verify baseline plus
absence/presence under that lock.

Modify the ordinary production runner so it requires exact hash-pinned 044-049
records before a release, never applies those files itself, and does not run them
through the expand-only parser after they are recorded. Modify the cleanup runner
to select exactly 038-043 and ignore later migrations rather than rejecting 044+.

**Step 4: Generate the SQL Editor fallback**

The bundle must:

- Execute `BEGIN`, acquire `pg_advisory_xact_lock`, then verify migration 043,
  required schema signatures, and absence of 044-049 before applying source.
- Contain exact source for 044-049.
- Insert exact tracker rows only after each source succeeds.
- Verify all six rows before `COMMIT`.
- Exclude migrations 038-043 source and any later version.

Use the Supabase session pooler for protected automation where available. Use the verified SQL Editor artifact when direct IPv6 or pooler access is unavailable.

**Step 5: Run and commit**

Run: `npm test -- tests/integration/production-crm-migration-policy.test.ts tests/integration/production-migration-policy.test.ts tests/integration/production-cleanup-migration-policy.test.ts`

Expected: PASS.

```bash
git add scripts/apply-production-crm-migrations.mjs supabase/production-monday-crm-044-049.sql .github/workflows/production-crm-migrations.yml tests/integration/production-crm-migration-policy.test.ts scripts/apply-production-migrations.mjs scripts/apply-production-cleanup-migrations.mjs tests/integration/production-migration-policy.test.ts tests/integration/production-cleanup-migration-policy.test.ts .github/workflows/production-release.yml package.json README.md
git commit -m "ci: protect Monday CRM migrations"
```

## Task 12: Make Approved Revisions Truthful in the UI

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/use-widget-session-draft.ts`
- Modify: `lib/api/client.ts`
- Modify: `app/api/projects/[sessionId]/draft/route.ts`
- Modify: `app/api/attachments/link/route.ts`
- Create: `app/api/attachments/link/[linkId]/route.ts`
- Modify: `tests/api/attachments-link.test.ts`
- Modify: `tests/widget/widget-overlay-approved-confirmation.test.tsx`
- Modify: `tests/widget/widget-overlay-approve-idempotency.test.tsx`

**Step 1: Write failing UI tests**

Cover:

- First approval reports CRM queued, not delivered.
- Double-click creates one approval request.
- Editing after approval marks the brief as changed.
- Adding or removing an approved reference link marks the brief as changed.
- Monday is not updated until the user explicitly approves the changed brief.
- Reapproval displays the returned CRM revision.
- Monday outage does not turn a persisted approval into a false failure.

**Step 2: Run to verify failure**

Run: `npm test -- tests/widget/widget-overlay-approved-confirmation.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx`

Expected: FAIL because CRM revision state is not represented.

**Step 3: Implement minimal truthful state**

Extend the finalize client response with `crmQueued`, `crmRevision`, and
`approvedDraftVersion`. Expose the latest approved draft version, approval input
hash, canonical reference-set hash, and stable reference-link IDs when hydrating
canonical draft state. Add an authenticated DELETE-by-link-ID route scoped to the
current session. Derive `Approve updated brief` from server versions and the
canonical reference-set hash, not a browser-only marker.
Handle an in-flight canonical update by using the values returned from the atomic
approval transaction. Do not claim that Monday has received data until worker
evidence exists; the immediate copy should say that transfer is queued.

**Step 4: Run and commit**

Run: `npm test -- tests/widget/widget-overlay-approved-confirmation.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx`

Expected: PASS.

```bash
git add components/widget/widget-overlay.tsx components/widget/review-panel.tsx components/widget/use-widget-session-draft.ts lib/api/client.ts app/api/projects/[sessionId]/draft/route.ts app/api/attachments/link/route.ts app/api/attachments/link/[linkId]/route.ts tests/api/attachments-link.test.ts tests/widget/widget-overlay-approved-confirmation.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx
git commit -m "feat: expose explicit CRM approval revisions"
```

## Task 13: Prove the Release Journey and Run the Canary

**Files:**
- Modify: `tests/integration/release-proof-journey.test.ts`
- Modify: `tests/integration/release-proof-http.test.ts`
- Create: `tests/integration/monday-release-proof.test.ts`
- Create: `scripts/run-monday-canary.mjs`
- Create: `.github/workflows/monday-canary.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/production-release.yml`
- Modify: `docs/monday-crm-runbook.md`
- Modify: `docs/producer-review-runbook.md`

**Step 1: Add end-to-end failure-first proofs**

Prove:

- Consent -> draft -> approval -> CRM revision -> outbox claim -> create -> receipt.
- Historical pre-Monday consent cannot enqueue CRM work.
- Reapproval updates by stored item ID and preserves Monday-owned fields.
- Consent revocation before send suppresses disclosure.
- Deletion after sync verifies scrub, then deletes Monday before local completion.
- Deletion requested during `sending` or `delivery_unknown` cannot complete until
  the late create is found and scrubbed/deleted.
- Create response loss enters unknown and recovers without duplicate creation.
- Duplicate CRM keys create a terminal conflict.
- Schema drift blocks writes.
- Upsert schema drift still permits the minimal verified cleanup lane.
- Browser roles cannot read CRM tables or execute CRM RPCs.

**Step 2: Run to verify failure**

Run: `npm test -- tests/integration/monday-release-proof.test.ts`

Expected: FAIL until all release paths are wired.

**Step 3: Add CI release proof**

Use a mock Monday transport for deterministic CI and the disposable Supabase
stack for database/RPC behavior. Add a protected manual canary script/workflow
that uses an opaque key, checks the live schema fingerprint, creates, updates,
reconciles, scrubs, and deletes one item, and guarantees cleanup on failure. It
must assert before/after that Owner, Stage, follow-up, and notes are unchanged and
write only PII-free evidence.

**Step 4: Execute all verification gates**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
npm audit --audit-level=high
git diff --check
```

Expected: all project gates pass; database tests may skip locally only when the documented disposable database prerequisite is absent, but they must run in CI.

**Step 5: Run protected pre-production canary**

Roll out in this order:

1. Prove the old application remains compatible with database migrations 044-049
   while both Monday lanes are dormant.
2. Apply protected migrations 044-049 under the shared advisory lock while the
   old application remains active.
3. Deploy the new code with both Monday lanes disabled.
4. Enable cleanup only and run the deletion canary.
5. Run create/update/reconcile/scrub/delete canary evidence.
6. Enable new upserts.

Never activate scheduler health requirements before the matching code, schema,
workflow, and feature lane are live.

Before setting `MONDAY_UPSERT_ENABLED=true`, first enable and canary
`MONDAY_CLEANUP_ENABLED`, then require:

- Production migrations 044-049 recorded.
- Dedicated token rotated or OAuth connected.
- Live board schema fingerprint matches.
- One canary create, reapproval update, reconciliation, and deletion succeeds.
- Owner, stage, follow-up, and notes remain unchanged after update.
- No analysis file or private-storage metadata appears in Monday.
- Scheduler health is green.
- BD signs off on required fields, views, assignment, and daily triage.
- Privacy owner signs off on retention and deletion behavior.

**Step 6: Commit**

```bash
git add tests/integration/release-proof-journey.test.ts tests/integration/release-proof-http.test.ts tests/integration/monday-release-proof.test.ts scripts/run-monday-canary.mjs .github/workflows/monday-canary.yml .github/workflows/ci.yml .github/workflows/production-release.yml docs/monday-crm-runbook.md docs/producer-review-runbook.md
git commit -m "test: prove Monday CRM release journey"
```

## Final Red-Team Gate

Before merge, dispatch independent reviewers for:

| Reviewer | Required focus |
|---|---|
| Privacy | Consent timing, analysis-file exclusion, retention, revocation, deletion |
| Database | Atomicity, leases, stale ownership, RLS, grants, migration safety |
| Monday API | Version, auth, schema shape, idempotency, rate limits, unknown delivery |
| BD operations | Field ownership, nullable contact fields, views, triage, assignment |
| Adversarial | Duplicate creation, malformed data, token leakage, schema drift, replay |

Reject release if any reviewer cannot reproduce the board schema, deletion path,
or no-overwrite guarantee from checked-in tests and live canary evidence.
