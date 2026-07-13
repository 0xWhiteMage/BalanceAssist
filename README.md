# Balance Assist

AI assistant widget for Balance Studio. Embeds as a floating widget on the live site, talks to leads via Deepseek with tool calling, captures a structured brief in a persistent left rail, and relays human handoff to Telegram in real time. Scoped to three legitimate use cases: project briefs, job applications, and general questions about Balance.

## Commands

- `npm install`
- `npm run dev` — local dev server at http://127.0.0.1:3000
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e`

## Routes

- `/` — landing page
- `/widget` — full reference board (design preview)
- `/preview` — real Balance Studio site with the widget overlaid
- `/internal/uploads` — admin-only browser for uploaded reference files (requires `SETUP_TOKEN`)

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
- `POST /api/telegram/upload` — file upload metadata only; the file itself is hosted by Telegram and referenced by `telegram_file_id`
- `POST /api/attachments/link` — persist a reference link (YouTube, Vimeo, Figma, Loom, Google Drive, other) for the current session
- `POST /api/telegram/schedule-complete` — notify Telegram that a Calendly catch-up was booked

Admin (require `SETUP_TOKEN`):

- `POST /api/telegram/setup` — one-call bot verification + webhook setup
- `GET /api/internal/uploads` — list uploaded files with signed download URLs
- `GET /api/sessions/inspect` — inspect a session by id
- `GET /api/telegram/list-topics` — list Telegram forum topics
- `POST /api/telegram/cleanup-topics` — close stale Telegram forum topics

## Environment variables

See `.env.example` for the canonical list. Summary:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project
- `SUPABASE_SERVICE_ROLE_KEY` (legacy) or `SUPABASE_SECRET_KEY` (preferred) — server-side Supabase access
- `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-v4-flash`) — LLM provider
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — Telegram relay
- `SETUP_TOKEN` — protects admin endpoints and `/internal/uploads`

## Deploy to production

### 1. Create a GitHub repo

```bash
git remote add origin https://github.com/<your-username>/balance-assist.git
git push -u origin main
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

The authoritative schema is the incremental chain from `001_initial_schema.sql` through `031_private_attachment_cleanup_hardening.sql` (including the intentionally absent `005` version). `000_full_schema.sql` is a legacy snapshot and must not be combined with the incremental chain. Migration `027_handoff_send_reservations.sql` remains part of that chain. Temporary-draft expiry is invoked every five minutes by the GitHub Actions worker. A dispatcher reserves `sending` for 90 seconds before its 45-second Telegram call; expiry or revoked consent suppresses only unclaimed handoffs and cannot retract an already accepted external transfer.

Chat requires an authenticated session capability and an allowed request origin. Chat calls are limited durably to 20 per session capability per hour; session creation is limited to 10 per client IP per hour. Production Vercel deployments must set `TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for`; session creation fails with `session_rate_limit_identity_unavailable` when that trusted identity is unavailable. `X-Forwarded-For` and `X-Real-IP` are never accepted directly.

Rate-limit retention is not part of the request path. When `pg_cron` is installed, migration `020` schedules a daily bounded prune. Otherwise schedule `select public.prune_api_rate_limits(500)` daily with the deployment's database maintenance facility. Migrations `030` and `031` provision the private `temporary-attachments` bucket, revoke `PUBLIC`, `anon`, and `authenticated` direct object access, remove all browser-role object policies by catalog identity, and report unavailable unless that safety can be proven. Uploads fail closed unless readiness is `ready`. New stored files and cleanup records use UUID-only opaque keys; migration `031` marks legacy session-prefixed paths cleanup-required, so the authenticated expiry worker deletes the object before deleting its metadata and never declares incomplete cleanup safe.

For a disposable PostgreSQL database, set `TEST_DATABASE_URL`, prepare the schema, then run the database tests:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/balance_assist_test npm run test:db:prepare
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/balance_assist_test npm run test:db
```

Do not point `TEST_DATABASE_URL` at production data.

## Intake flow

The widget captures a project brief in a persistent left rail alongside the chat. The chat is fully LLM-driven — there are no preset quick-replies. The LLM extracts structured fields across multiple turns using the `record_brief_updates` tool, accumulates additional project context into a `projectScope` field, and ends brief-mode replies with a follow-up question for the next missing field.

- The persistent left rail (`ReviewPanel`) is visible from the moment the visitor signals project intent. It shows a progress strip, the eight reviewable fields (project scope, project type, service, timeline, budget, contact name, company, email), and a Send-to-team CTA. Every field is click-to-edit, even when unfilled.
- The rail's CTA is **always visible** — labelled "Send to team" in essentials mode and "Approve & send to team" in summary mode — and is disabled until all eight fields are filled. Clicking it is the only action that calls `POST /api/leads/finalize` and forwards to Telegram + Supabase. After send, the widget confirms the brief is approved, shows the Telegram broadcast status, and offers options to book a catch-up or talk to a human.
- Reference attachments live in an attachments popover above the chat input bar. Leads can paste a YouTube, Vimeo, Figma, Loom, or Google Drive URL (classified automatically), persisted via `POST /api/attachments/link` into `reference_links`. Analysis-consented file uploads are enabled only when `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` is configured and the server verifies that private bucket. Stored files use opaque keys, expire after 24 hours, are not shared with the Balance team in this slice, and are not delivered to Telegram. The popover is opt-in — the rail shows a clean "no attachments yet" hint when the list is empty.

The widget also answers general questions about Balance, drafts Balance job-application material, and falls back to local responses when the LLM is unavailable. Out-of-scope requests (homework, recipes, roleplay, etc.) are declined and the user is pointed back to the three in-scope paths.
