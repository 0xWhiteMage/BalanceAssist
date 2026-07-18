# Balance Assist

AI assistant widget for Balance Studio. It captures project briefs and answers general Balance questions. Same-browser drafts are temporary for up to 24 hours; a producer receives no effect until the user explicitly approves transfer.

## Commands

- Node 22 and npm 10 are required (`.node-version` and `package.json` are authoritative).
- `npm ci`
- `npm run dev` — local dev server at http://127.0.0.1:3000
- `npm run lint`
- `npm test`
- `npm run build`
- `npx playwright install chromium` (once per development machine), then `npm run test:e2e`
- `npm run test:db` (requires `TEST_DATABASE_URL` and a prepared disposable PostgreSQL database)
- `npm run test:supabase` (optional local Docker + Supabase CLI release journey; CI owns this check)

## Routes

- `/` — landing page
- `/widget` — full reference board (design preview)
- `/preview` — real Balance Studio site with the widget overlaid
- `/internal/uploads` — privileged upload-inspection route (requires `SETUP_TOKEN`)

## API endpoints

Public (called by the widget):

- `POST /api/sessions` — create a chat session
- `POST /api/events` — log analytics events
- `POST /api/leads/finalize` — save a qualified lead (skips empty drafts)
- `POST /api/chat` — Deepseek-backed chat completion
- `POST /api/telegram/relay` — forward a user message to the team's Telegram
- `GET /api/telegram/messages` — poll for new team replies
- `POST /api/telegram/webhook` — Telegram sends replies here
- `POST /api/telegram/simulate` — dev-only: simulate a team reply
- `POST /api/telegram/upload` — analysis-only private attachment upload; files are never forwarded to Telegram or the Balance team
- `POST /api/attachments/link` — persist a reference link (YouTube, Vimeo, Figma, Loom, Google Drive, other) for the current session
- `POST /api/telegram/schedule-complete` — rejects unverified browser booking claims; it does not notify Telegram

Admin (require `SETUP_TOKEN`):

- `POST /api/telegram/setup` — one-call bot verification + webhook setup
- `GET /api/internal/uploads` — returns filenames, session/contact metadata, and one-hour signed download URLs. Treat this response as restricted data: use only over an authenticated operator session, do not copy it to tickets or logs, and let signed URLs expire rather than sharing them.
- `GET /api/sessions/inspect` — inspect a session by id
- `GET /api/telegram/list-topics` — list Telegram forum topics
- `POST /api/telegram/cleanup-topics` — close stale Telegram forum topics

## Environment variables

See `.env.example` for the canonical list. Summary:

- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` — server-side Supabase access
- `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-v4-flash`) — LLM provider
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — Telegram relay
- `SETUP_TOKEN` — protects admin endpoints and `/internal/uploads`
- `CRON_SECRET` — authenticates scheduled internal workers; use the same value in GitHub Actions and Vercel production
- `INTERNAL_DISPATCH_SECRET` — optional dedicated credential for the synchronous handoff fast path; otherwise `CRON_SECRET` is used
- `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_IDS` — authenticate the webhook and authorize replies by immutable numeric Telegram user ID
- `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` — required for analysis-only private uploads
- `MONDAY_*` — dormant CRM projection settings; both write-lane flags remain `false` until their separate release approval

## Deploy to production

### 1. Production prerequisites

```bash
Apply the full incremental migration chain in order through `061_api_security_retention_and_upload_quota.sql` (except intentionally absent `005`, `050`, and `051`). Do not combine it with legacy snapshot `000_full_schema.sql`. Versions `038` through `043` use the dedicated reviewed cleanup path, CRM versions use their protected workflow, `060` runs at the consent cutover gate, and `061` uses its hash-protected artifact in the production migration job; do not apply those special migrations ad hoc.
```

### 2. Connect Vercel

1. Import the GitHub repo at https://vercel.com/new with the **Next.js** preset.
2. Add every runtime environment variable from `.env.example`.
3. After initial setup, disconnect the Vercel project from the Git repository before any protected migration or release. This prerequisite prevents any push from deploying routes before migration `061` has installed their required RPCs; protected releases continue through Vercel CLI. Repository changes do not alter this live Vercel setting.
4. Configure the production domain alias, but do not deploy it manually.

GitHub Actions, not Vercel Cron, schedules authenticated workers and is the only production deployment path. The `Production release` workflow must itself be dispatched from its trusted `refs/heads/main` definition; it pins every action to a full commit SHA and invokes the exact lockfile-backed local Vercel CLI, never a mutable `npx` version.

### 3. Configure GitHub secrets

In **Settings → Secrets and variables → Actions** add:

| Secret | Purpose |
|---|---|
| `PRODUCTION_URL` | Deployed domain, e.g. `https://balance-assist.vercel.app` |
| `SETUP_TOKEN` | Same value as in Vercel env |
| `CRON_SECRET` | Authenticates GitHub Actions calls to `/api/internal/handoff-dispatch`; also set the same value in Vercel runtime environment variables |
| `TELEGRAM_BOT_TOKEN` | Same as in Vercel env |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `production` environment only; immutable Vercel deploy and alias promotion |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `production` environment only; bounded schema/service-role readiness probes |
| `PRODUCTION_DATABASE_URL` | `production-migrations` environment only; never repository configuration |
| `SUPABASE_ACCESS_TOKEN` | `production-crm-migrations`, `production-cleanup-migrations`, and `production` canary environments; runs reviewed SQL and migration-record checks through the Supabase Management API |
| `PRODUCTION_BACKUP_AUDIT_REFERENCE` | `production-cleanup-migrations` environment only; protected backup/audit record bound to the cleanup release SHA |

Add two repository Actions variables for release review. `RELEASE_TRUSTED_REVIEWERS` is a comma-separated allowlist of unique GitHub logins authorized to sign release-review issues. `RELEASE_MIN_REVIEWERS` is an integer from `1` through `5` and sets the minimum number of distinct allowlisted reviewers required across the five discipline reviews. Both variables are mandatory and invalid or absent values fail the release before review records are fetched. The workflow always requires five separate SHA-bound review artifacts for product/UX, engineering, accessibility, conversation, and trust/privacy, even when one trusted person covers multiple roles. This makes a personal repository operational without reducing approval to an unrecorded dispatch or environment self-approval. Treat changes to either variable as administrative security events and review them separately from the release.

Set the protected `production` environment variable `VERCEL_GIT_DEPLOYMENTS_DISABLED_AT` to a UTC ISO-8601 dashboard-audit timestamp (for example, `2026-07-14T12:00:00Z`). This is a prerequisite for the production migration job, not a command that changes Vercel. The release gate rejects absent, malformed, future, or more-than-90-day-old attestations and uses the Vercel project API read-only to confirm the expected project is disconnected from Git; protected releases remain available through the Vercel CLI. Recheck the Vercel setting before each release and quarterly; a failed gate or a Vercel Git deployment outside a release is an alert requiring the setting to be disabled and the release/audit history to be reviewed.

Create every GitHub environment referenced by `.github/workflows/production-release.yml`, including `production`, `production-migrations`, `production-release-review`, and `production-consent-cutover`, with deployment restricted to `main` and required approval where the account plan supports it. Environment approval is an additional gate, not a substitute for the SHA-bound issue records and configured trusted-reviewer threshold. Protect `main` as the release branch. Manually dispatch `Production release` with a lowercase 40-character commit SHA. Before a protected environment or credential is available, the workflow safely fetches `main`, confirms the SHA is a reachable commit ancestor, and emits the canonical SHA. Every credentialed job directly needs that validated output. It then reruns lint, typecheck, unit, local Supabase migration/integration, build, E2E, audit, and diff gates; deploys that SHA to an immutable Vercel URL; smokes its health route and service-role schema readiness; waits for approved production migration and deployment proof; promotes the immutable deployment to the production alias; smokes the alias and readiness again; then configures Telegram. Missing Vercel, URL, setup-token, Telegram-token, Supabase readiness credentials, Vercel-audit attestation, either release-review variable, or required cleanup prerequisite fails the release.

After merging repository policy changes, follow [`docs/post-merge-live-settings.md`](docs/post-merge-live-settings.md) to verify GitHub and Vercel controls. Repository commits do not change those live settings.

Production migrations are forward-only and run only in the protected `production-migrations` job after disposable-stack validation and immutable-deployment smoke, before deployment review and alias promotion. Starting after `037_scheduler_health.sql`, the ordinary runner fail-closes unless a migration is exactly one supported additive `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, or `CREATE INDEX` statement. Migration `061` is deliberately excluded from that ordinary runner: the same job hash-verifies `supabase/migrations/061_api_security_retention_and_upload_quota.sql` and `supabase/production-api-security-061.sql`, applies the reviewed artifact after the live compatibility baseline `059`, then verifies its table, functions, RLS, owners, and grants. This permits 061 to precede alias promotion while consent cutover `060` retains its existing post-alias ordering. Never put the production database credential in `.env` or run it outside the approved workflow.

Migration `027_handoff_send_reservations.sql` introduced the bounded Telegram send reservation described in `docs/temporary-session-retention.md`; its remaining at-least-once delivery ambiguity is intentional and documented.

CRM migrations use the separate protected `production-crm-migrations` workflow. It hash-verifies the checked-in SQL artifact, then uses `SUPABASE_ACCESS_TOKEN` through the Supabase Management API; it does not use a direct database connection URL. The production canary verifies migration records through the Supabase Management API before it contacts Monday.

### One-time cleanup migration runbook

`038_durable_deletion_jobs.sql` through `043_deletion_state_batched_cleanup.sql` are reviewed destructive cleanup migrations. They are a one-time sequence, not a general-purpose SQL path. Do not add versions or modify their reviewed content: the dedicated runner permits only these filenames, versions, SHA-256 source hashes, and the exact `supabase/production-cleanup-038-043.sql` artifact.

1. Take and validate a production backup, review the deletion/audit state, and retain the evidence with the release record.
2. Create the protected `production-cleanup-migrations` environment secret `PRODUCTION_BACKUP_AUDIT_REFERENCE` before dispatch. Its exact format is `BACKUP_AUDIT:<UTC ISO-8601 timestamp>|<provider>|<backup-or-audit-id>|<release SHA>`; the timestamp must be current, not future, and no more than 24 hours old, and the SHA must exactly match the selected cleanup release. Do not place this record in the dispatch form or workflow output.
3. Manually dispatch `Production cleanup migrations` with the exact lowercase 40-character SHA already reachable from protected `main`. The workflow rejects any run whose workflow definition is not `refs/heads/main`, then waits for approval of the protected `production-cleanup-migrations` environment. It dry-runs the exact six reviewed migrations, validates the protected backup/audit reference, then uses the managed Supabase CLI with `SUPABASE_ACCESS_TOKEN` to execute the exact transaction artifact and verify `038,039,040,041,042,043` are recorded in `public.schema_migrations`.
4. Confirm the post-migration health smoke passes. This workflow does not build or deploy the application, change a Vercel alias, or configure any webhook.
5. If the managed workflow is unavailable after the same backup attestation and protected approval, use only `supabase/production-cleanup-038-043.sql` in the Supabase SQL Editor. Do not paste individual migrations or omit the backup attestation; retain the attestation with the release record.

After the recorded-version verification succeeds, dispatch the ordinary production release for later additive migrations as needed.

The `Handoff dispatch` workflow runs every five minutes and can be started with `workflow_dispatch`. This is a best-effort cadence: GitHub scheduled workflows can be delayed, especially during high load, so it does not guarantee dispatch exactly every five minutes. Dispatch retries wait at least one five-minute scheduler window. A fourth failed dispatch evaluation escalates pending handoffs at or after 15 minutes, subject to scheduler delay.

Enable GitHub Actions failure notifications for repository administrators and monitor failed `Handoff dispatch` runs, `handoff_failed`/`handoff_escalated` events, and pending or escalated `handoff_outbox` rows. A failed workflow needs investigation or a manual `workflow_dispatch` run; it does not prove a handoff was delivered.

Workers record authenticated heartbeats after successful runs. `Scheduler health` runs on the existing five-minute cadence and fails alert-ready when a worker misses a heartbeat for 20 minutes, the oldest pending `handoff_outbox` row exceeds 15 minutes, or expired sessions remain. GitHub schedules can be delayed; the heartbeat allowance covers latency without masking the handoff SLA. GitHub can disable schedules after 60 days without repository activity. On a failed or missing monitor run, inspect Actions history, re-enable scheduling by editing and committing a schedule entry, manually dispatch all scheduler workflows, and confirm healthy monitoring plus an empty backlog.

### 4. Verify the webhook

After immutable smoke and alias promotion, the protected release job calls `/api/telegram/setup` to point the bot at the production URL. To check manually:

```bash
curl -X POST https://your-domain.com/api/telegram/setup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SETUP_TOKEN" \
  -d '{"webhookUrl":"https://your-domain.com/api/telegram/webhook"}'
```

Expected response:
```json
{
  "ok": true,
  "bot": { "username": "balanceassistbot", "name": "Balance Assist" },
  "chat_id": "-100...",
  "webhook": { "url": "https://your-domain.com/api/telegram/webhook", "set": true }
}
```

## How the handoff relay works

```
Widget user → POST /api/telegram/relay
              → Bot sends "[Session <id>] <text>" to Telegram group
              → Message stored in Supabase `human_messages`

Team member sees message in Telegram
Team member replies (using Reply so it links to the bot's message)
              → Telegram POST /api/telegram/webhook
              → Backend matches reply to original via `reply_to_message_id`
              → Reply stored in Supabase `human_messages`

Widget polls GET /api/telegram/messages every 4 seconds
              → New team replies appear in the widget chat
```

The team must use Telegram's **Reply** action (long-press → Reply) so the backend can match the reply to the right session.

## Local testing without a public webhook

```bash
curl -X POST http://127.0.0.1:3000/api/telegram/simulate \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<id>","text":"Got it, we will review.","senderName":"Sam"}'
```

## Database setup

The authoritative schema is the full incremental chain from `001_initial_schema.sql` through `061_api_security_retention_and_upload_quota.sql`, excluding intentionally absent `005`, `050`, and `051`. The migration tracker is hardened by `035_schema_migrations_tracker_hardening.sql`; `000_full_schema.sql` is a legacy snapshot and must not be combined with the incremental chain. Temporary-draft expiry is invoked by the best-effort GitHub Actions worker every five minutes. A dispatcher reserves `sending` before bounded Telegram calls; expiry or revoked consent suppresses only unclaimed handoffs and cannot retract an already accepted external transfer.

Chat requires an authenticated session capability and an allowed request origin. Chat calls are limited durably to 20 per session capability per hour; session creation is limited to 10 per client IP per hour. Production Vercel deployments must set `TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for` and `ALLOWED_ORIGINS=https://balancestudio.tv,https://www.balancestudio.tv,https://balance-assist.vercel.app`. The Vercel origin is explicit; wildcard origins are not supported. Session creation fails with `session_rate_limit_identity_unavailable` when that trusted identity is unavailable. `X-Forwarded-For` and `X-Real-IP` are never accepted directly.

Rate-limit retention is not part of the request path. When `pg_cron` is installed, migration `020` schedules a daily bounded prune. Otherwise schedule `select public.prune_api_rate_limits(500)` daily with the deployment's database maintenance facility. Migrations `030` and `031` provision the private `temporary-attachments` bucket, revoke `PUBLIC`, `anon`, and `authenticated` direct object access, and remove browser-role object policies by catalog identity. Migration `033` attests that policy and grant state live for every upload; uploads fail closed on drift. New stored files and cleanup records use UUID-only opaque keys; migrations `031` and `032` remove legacy session-prefixed paths through guarded metadata cleanup or a storage-object-first migration, and expiry never declares incomplete cleanup safe.

For a disposable PostgreSQL database, set `TEST_DATABASE_URL`, prepare the schema, then run the database tests:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/balance_assist_test npm run test:db:prepare
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/balance_assist_test npm run test:db
```

Do not point `TEST_DATABASE_URL` at production data.

## Release proof

CI installs the Supabase CLI and starts a disposable local Docker stack. The repository's ordered migration runner applies the full incremental chain, excluding legacy `000_full_schema.sql`, against Supabase's local PostgreSQL database. This includes storage schema, bucket policies, and RPCs before the release journey runs against Supabase HTTP/PostgREST. The journey serves the production build in-process with an explicitly installed test transport, then drives session, analysis and producer-transfer consent, private attachment upload, canonical draft, finalize, authenticated dispatch, webhook, and polling routes. Its local fake Telegram boundary records JSON fields and multipart document metadata only, never attachment content. Production Telegram calls always use Telegram's fixed API origin; no environment variable can redirect them. `test:supabase` also runs the isolated handler-level journey after the HTTP proof.

For an optional local run, install Docker and the Supabase CLI, then run one command:

```bash
npm run test:supabase
```

When either prerequisite is unavailable, the command prints a clear skip message and exits successfully; ordinary unit tests do not require Docker or Supabase. CI remains the authoritative release-proof execution environment.

Playwright continues to build and start the production server. CI installs Chromium once, retries failures twice, and uploads HTML/JUnit reports, screenshots, and traces as the `playwright-report` artifact with 14-day retention.

## Intake flow

The widget captures a project brief in a persistent left rail alongside the chat. The chat is fully LLM-driven — there are no preset quick-replies. The LLM extracts structured fields across multiple turns using the `record_brief_updates` tool, accumulates additional project context into a `projectScope` field, and ends brief-mode replies with a follow-up question for the next missing field.

- The persistent left rail (`ReviewPanel`) is visible from the moment the visitor signals project intent. It shows a progress strip, the eight reviewable fields (project scope, project type, service, timeline, budget, contact name, company, email), and a Send-to-team CTA. Every field is click-to-edit, even when unfilled.
- The rail's CTA is **always visible** — labelled "Send to team" in essentials mode and "Approve & send to team" in summary mode — and is disabled until all eight fields are filled. Clicking it is the only action that calls `POST /api/leads/finalize` and forwards to Telegram + Supabase. After send, the widget confirms the brief is approved, shows the Telegram broadcast status, and offers options to book a catch-up or talk to a human.
- Reference attachments live in an attachments popover above the chat input bar. Links require separate producer-transfer consent. Analysis-consented files are enabled only when `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` is configured and the server live-attests the private bucket. Files use opaque keys, are retained solely to analyse the current draft for up to 24 hours, and are never sent to the Balance team or Telegram.

The widget also answers general questions about Balance and falls back to local responses when the LLM is unavailable. Careers requests redirect to Balance's official careers page; the widget does not collect applicant material. Out-of-scope requests (homework, recipes, roleplay, etc.) are declined.
