# Balance Assist

AI assistant widget for Balance Studio. It captures project briefs and answers general Balance questions. Same-browser drafts are temporary for up to 24 hours; a producer receives no effect until the user explicitly approves transfer.

## Commands

- `npm install`
- `npm run dev` — local dev server at http://127.0.0.1:3000
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e`
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

## Deploy to production

### 1. Production prerequisites

```bash
Apply the full incremental migration chain in order, from `001_initial_schema.sql` through `035_schema_migrations_tracker_hardening.sql` (except intentionally absent `005`). Do not combine it with legacy snapshot `000_full_schema.sql`.
```

### 2. Connect Vercel

1. Import the GitHub repo at https://vercel.com/new
2. Framework preset: **Next.js**
3. Add every environment variable from `.env.example`
4. Click **Deploy**

Vercel auto-deploys on every push to `main`. GitHub Actions, not Vercel Cron, schedules authenticated handoff dispatches.

### 3. Configure GitHub secrets

In **Settings → Secrets and variables → Actions** add:

| Secret | Purpose |
|---|---|
| `PRODUCTION_URL` | Deployed domain, e.g. `https://balance-assist.vercel.app` |
| `SETUP_TOKEN` | Same value as in Vercel env |
| `CRON_SECRET` | Authenticates GitHub Actions calls to `/api/internal/handoff-dispatch`; also set the same value in Vercel runtime environment variables |
| `TELEGRAM_BOT_TOKEN` | Same as in Vercel env |

The `Handoff dispatch` workflow runs every five minutes and can be started with `workflow_dispatch`. This is a best-effort cadence: GitHub scheduled workflows can be delayed, especially during high load, so it does not guarantee dispatch exactly every five minutes. Dispatch retries wait at least one five-minute scheduler window. A fourth failed dispatch evaluation escalates pending handoffs at or after 15 minutes, subject to scheduler delay.

Enable GitHub Actions failure notifications for repository administrators and monitor failed `Handoff dispatch` runs, `handoff_failed`/`handoff_escalated` events, and pending or escalated `handoff_outbox` rows. A failed workflow needs investigation or a manual `workflow_dispatch` run; it does not prove a handoff was delivered.

GitHub automatically disables scheduled workflows after 60 days without repository activity on public repositories. Failed-run notifications do not detect this silent disablement. Alert when no `Handoff dispatch` run starts within 15 minutes or when the oldest pending `handoff_outbox` row exceeds 15 minutes. An administrator must inspect the workflow's run history, re-enable scheduling by editing and committing the workflow's `schedule` entry, then verify that the next scheduled run starts and that the oldest pending row is processed.

### 4. Verify the webhook

After the first deploy, the GitHub Action calls `/api/telegram/setup` to point the bot at your production URL. To check manually:

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

The authoritative schema is the full incremental chain from `001_initial_schema.sql` through `035_schema_migrations_tracker_hardening.sql`, including `027_handoff_send_reservations.sql` and excluding intentionally absent `005`. `000_full_schema.sql` is a legacy snapshot and must not be combined with it. Temporary-draft expiry is invoked by the best-effort GitHub Actions worker every five minutes. A dispatcher reserves `sending` for 90 seconds before its 45-second Telegram call; expiry or revoked consent suppresses only unclaimed handoffs and cannot retract an already accepted external transfer.

Chat requires an authenticated session capability and an allowed request origin. Chat calls are limited durably to 20 per session capability per hour; session creation is limited to 10 per client IP per hour. Production Vercel deployments must set `TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for`; session creation fails with `session_rate_limit_identity_unavailable` when that trusted identity is unavailable. `X-Forwarded-For` and `X-Real-IP` are never accepted directly.

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

Playwright continues to build and start the production server. CI retries failures twice and uploads HTML/JUnit reports, screenshots, and traces from failed runs as the `playwright-report` artifact.

## Intake flow

The widget captures a project brief in a persistent left rail alongside the chat. The chat is fully LLM-driven — there are no preset quick-replies. The LLM extracts structured fields across multiple turns using the `record_brief_updates` tool, accumulates additional project context into a `projectScope` field, and ends brief-mode replies with a follow-up question for the next missing field.

- The persistent left rail (`ReviewPanel`) is visible from the moment the visitor signals project intent. It shows a progress strip, the eight reviewable fields (project scope, project type, service, timeline, budget, contact name, company, email), and a Send-to-team CTA. Every field is click-to-edit, even when unfilled.
- The rail's CTA is **always visible** — labelled "Send to team" in essentials mode and "Approve & send to team" in summary mode — and is disabled until all eight fields are filled. Clicking it is the only action that calls `POST /api/leads/finalize` and forwards to Telegram + Supabase. After send, the widget confirms the brief is approved, shows the Telegram broadcast status, and offers options to book a catch-up or talk to a human.
- Reference attachments live in an attachments popover above the chat input bar. Links require separate producer-transfer consent. Analysis-consented files are enabled only when `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` is configured and the server live-attests the private bucket. Files use opaque keys, are retained solely to analyse the current draft for up to 24 hours, and are never sent to the Balance team or Telegram.

The widget also answers general questions about Balance and falls back to local responses when the LLM is unavailable. Careers requests redirect to Balance's official careers page; the widget does not collect applicant material. Out-of-scope requests (homework, recipes, roleplay, etc.) are declined.
