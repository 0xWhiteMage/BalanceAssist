# Producer Review Runbook

## Monday CRM Release Gate

Do not tell a producer that Monday has received a brief when approval only reports
that the transfer is queued. Before enabling Monday upserts, BD must review the
PII-free canary evidence, confirm owner, stage, follow-up, and notes were not
overwritten, and sign off on assignment and daily triage. Privacy must separately
approve the scrub-and-delete evidence and retention behavior. Historical `1.0`
producer-transfer consent never authorizes Monday disclosure.

## Use This Runbook When

- briefs are persisted but producer handoffs are not arriving
- private analysis files are being quarantined unexpectedly
- users report that reset or deletion actions did not stick
- webhook-auth or scheduling verification incidents occur

## Primary Checks

1. Confirm the session status and canonical draft in Supabase.
2. Check recent trust events for:
   - `lead_persisted`
   - `handoff_enqueued`
   - `attachment_quarantined`
   - `deletion_requested`
   - `project_reset`
3. Check `handoff_outbox` state for pending, failed, or escalated rows.
4. Confirm Telegram webhook configuration:
   - `TELEGRAM_WEBHOOK_SECRET`
   - `TELEGRAM_CHAT_ID`
   - `TELEGRAM_ALLOWED_USERNAMES`
5. Confirm the dispatcher scheduler is invoking the authenticated dispatch route.
    - GitHub Actions workflow: `Handoff dispatch` (`.github/workflows/handoff-dispatch.yml`)
    - Dispatch path: `/api/internal/handoff-dispatch`
    - Required GitHub Actions secrets: `PRODUCTION_URL` and `CRON_SECRET`; the same `CRON_SECRET` must be configured in Vercel runtime environment variables.
    - The workflow is scheduled every five minutes and can be manually run with `workflow_dispatch`. GitHub cron is best effort and may be delayed, so do not treat this as an exact five-minute SLA.
    - Review failed workflow runs and GitHub Actions notifications. Monitor `handoff_failed` and `handoff_escalated` events and pending/escalated `handoff_outbox` rows.

## Internal Upload Inspection

`GET /api/internal/uploads` requires `Authorization: Bearer <SETUP_TOKEN>`. Its response contains filenames, session identifiers, contact name/company metadata, and one-hour signed download URLs. Use it only from an authenticated operator session; do not put the response, URLs, or file metadata in tickets, chat, analytics, or logs. Download only when necessary, keep the material in approved storage, and allow URLs to expire instead of forwarding them.

## Handoff Retry Timing

- A failed handoff is eligible for its next attempt no sooner than five minutes later; actual dispatch depends on the next GitHub Actions run and may be later.
- The dispatcher allows four delivery attempts. The fourth evaluation escalates handoffs that are at least 15 minutes old, including a run exactly on the five-minute boundary. Scheduler delay can make escalation later; it cannot make retries occur faster.
- Use `workflow_dispatch` after resolving an incident to process due rows. Do not infer delivery from a successful workflow run; inspect the outbox state and handoff events.

## Scheduled Workflow Disablement

GitHub automatically disables scheduled workflows after 60 days without repository activity on public repositories. This produces no failed run, so failed-run notifications alone do not detect it.

1. Alert when no `Handoff dispatch` run has started within 15 minutes, or when the oldest pending `handoff_outbox` row is older than 15 minutes.
2. An administrator checks the workflow's run history in GitHub Actions. If no scheduled run exists, treat the scheduler as disabled rather than waiting for a failure notification.
3. Re-enable scheduling by editing and committing the workflow's `schedule` entry, then confirm the next scheduled run starts.
4. Confirm the oldest pending outbox row is processed or explicitly escalated. Use `workflow_dispatch` only to recover due work; it does not prove recurring scheduling is re-enabled.

## Database Access Hardening Rollout

This is a forward-only RLS and grant change. Validate it in staging before production; do not edit or replay an already deployed migration.

1. Record a production backup and schema/grant inventory before deployment:
   - export the affected `public` table definitions and ACLs
   - record RLS state and policies for `sessions`, `events`, `leads`, `human_messages`, `uploaded_files`, `reference_links`, `processed_telegram_updates`, `handoff_outbox`, and `schema_migrations`
2. Run the migration against a production-shaped disposable database or staging clone. Confirm it applies once and leaves all server migrations recorded.
3. In staging, exercise service-role-backed routes for session creation, event capture, lead finalization, uploads, Telegram relay/replay protection, and handoff dispatch. Confirm the server still reads and writes each affected table.
4. Run PostgREST/public access smoke checks with the project URL and anon key. `select` and `insert` against every affected table must be denied for both anonymous and authenticated JWT contexts.
5. Run a staging PostgREST smoke check with the deployed Supabase service key. Confirm representative `select` and `insert` operations still succeed through the project URL, then remove test data. The disposable plain-PostgreSQL `server_role_simulation` test does not validate a deployed Supabase service key.
6. Re-run the grant and RLS inventory after the smoke checks. Each affected table must have RLS enabled and neither `anon` nor `authenticated` may retain table privileges.
7. Deploy to production only after staging validation succeeds. Monitor route errors, PostgREST authorization failures, and handoff delivery during the rollout window.

## Handoff Send Reservation Rollout

Apply migration `027_handoff_send_reservations.sql` before deploying dispatcher code that calls `reserve_handoff_send`. The migration releases tokenless pre-026 `claiming` rows to `pending`; pause dispatch after applying it and wait at least 90 seconds before enabling the new dispatcher, so an old worker cannot complete a subsequently reclaimed claim with its unconditional legacy update. Do not run old and new dispatcher versions concurrently. After the drain, deploy the new code and resume dispatch. The bounded reservation prevents concurrent reclaim during a normal 45-second Telegram call, but it does not promise exactly-once external delivery after a crash, acknowledgement loss, or process pause beyond 90 seconds.

### Isolated Service-Role Test

Use only a dedicated disposable or staging Supabase project that already has the RLS migration applied. Never set these variables to a production URL or production service-role key. The project ref must match `balance-assist-test-*`, and the URL must exactly be `https://<project-ref>.supabase.co` with no port, path, query, or fragment.

```bash
export TEST_SUPABASE_URL=https://balance-assist-test-ci.supabase.co
export TEST_SUPABASE_SERVICE_ROLE_KEY=<test-project-service-role-key>
export TEST_SUPABASE_ANON_KEY=<test-project-anon-key>
export TEST_SUPABASE_PROJECT_REF=balance-assist-test-ci
export ALLOW_TEST_SUPABASE_SERVICE_ROLE=1
npm run test:supabase:service-role
```

The test inserts and removes an isolated marker-scoped `sessions` row with the configured service-role key, then verifies valid-anon PostgREST requests receive `401` or `403` for `sessions`, `leads`, and `handoff_outbox`. It does not carry an authenticated-user JWT. Staging validation must therefore include an authenticated JWT PostgREST `select` and `insert` denial check for every affected application table before production rollout.

CI always creates the check job. Set repository variable `REQUIRE_TEST_SUPABASE_SERVICE_ROLE=1` only after configuring the four `TEST_SUPABASE_*` secrets for the dedicated test project; required mode fails on missing configuration without printing secret values. With required mode unset, CI prints an explicit skip and does not send a request.

## Failure Patterns

### Brief saved but producer not notified

- Look for `lead_persisted` without `handoff_enqueued`.
- Inspect `app/api/leads/finalize` logs and the session's recorded producer-share consent.

### Private analysis upload is unavailable or quarantined

- Confirm `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` and migration `033` live attestation are healthy.
- Confirm the user granted analysis consent. Analysis files are never sent to the team or Telegram.
- Review aggregate `attachment_quarantined` events; filenames and file content are intentionally unavailable in observability.

### User says reset/delete did not work

- Check for `project_reset` or `deletion_requested`.
- If missing, the action did not complete server-side; investigate route failure.

### Telegram message appears suspicious

- Verify the webhook event came from the configured chat and an allowed sender.
- If sender allowlist or chat config was missing, treat it as a config incident.

## Escalation

- Escalate immediately if producer notifications fail after lead persistence.
- Escalate immediately if suspicious webhook activity is detected.
- Escalate if reset/deletion requests are being acknowledged in UI but no server events exist.
