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
