# Producer Review Runbook

## Use This Runbook When

- briefs are persisted but producer handoffs are not arriving
- uploads are being quarantined unexpectedly
- users report that reset or deletion actions did not stick
- webhook-auth or scheduling verification incidents occur

## Primary Checks

1. Confirm the session status and canonical draft in Supabase.
2. Check recent trust events for:
   - `lead_persisted`
   - `handoff_enqueued`
   - `attachment_forwarded`
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

## Handoff Retry Timing

- A failed handoff is eligible for its next attempt no sooner than five minutes later; actual dispatch depends on the next GitHub Actions run and may be later.
- The dispatcher allows three delivery attempts and escalates handoffs once they are older than 15 minutes when a dispatch run evaluates them. Scheduler delay can make escalation later; it cannot make retries occur faster.
- Use `workflow_dispatch` after resolving an incident to process due rows. Do not infer delivery from a successful workflow run; inspect the outbox state and handoff events.

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

### Upload accepted but not sent to team

- Check whether the session was finalized.
- Check whether producer-share consent was recorded server-side.
- Review `attachment_quarantined` vs `attachment_forwarded` events.

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
