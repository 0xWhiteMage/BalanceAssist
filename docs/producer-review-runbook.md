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
   - Vercel cron path: `/api/internal/handoff-dispatch`
   - Required auth secret: `CRON_SECRET` (or `INTERNAL_DISPATCH_SECRET` for manual/internal callers)

## Database Access Hardening Rollout

This is a forward-only RLS and grant change. Validate it in staging before production; do not edit or replay an already deployed migration.

1. Record a production backup and schema/grant inventory before deployment:
   - export the affected `public` table definitions and ACLs
   - record RLS state and policies for `sessions`, `events`, `leads`, `human_messages`, `uploaded_files`, `reference_links`, `processed_telegram_updates`, and `handoff_outbox`
2. Run the migration against a production-shaped disposable database or staging clone. Confirm it applies once and leaves all server migrations recorded.
3. In staging, exercise service-role-backed routes for session creation, event capture, lead finalization, uploads, Telegram relay/replay protection, and handoff dispatch. Confirm the server still reads and writes each affected table.
4. Run PostgREST/public access smoke checks with the project URL and anon key. `select` and `insert` against every affected table must be denied for both anonymous and authenticated JWT contexts.
5. Re-run the grant and RLS inventory after the smoke checks. Each affected table must have RLS enabled and neither `anon` nor `authenticated` may retain table privileges.
6. Deploy to production only after staging validation succeeds. Monitor route errors, PostgREST authorization failures, and handoff delivery during the rollout window.

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
