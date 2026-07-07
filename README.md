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

Vercel auto-deploys on every push to `main`.

### 3. Configure GitHub secrets

In **Settings → Secrets and variables → Actions** add:

| Secret | Purpose |
|---|---|
| `PRODUCTION_URL` | Deployed domain, e.g. `https://balance-assist.vercel.app` |
| `SETUP_TOKEN` | Same value as in Vercel env |
| `TELEGRAM_BOT_TOKEN` | Same as in Vercel env |

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

Run the SQL files in `supabase/migrations/` in order, in the Supabase SQL editor:

1. `001_initial_schema.sql` — sessions, events, leads
2. `002_human_messages.sql` — handoff messages
3. `003_telegram_topics.sql` — Telegram forum-topic tracking
4. `004_contact_capture.sql` — captured contact fields on sessions
5. `006_human_file_request_state.sql` — human-side file-request flag
6. `007_uploaded_files.sql` — uploaded-files registry
7. `008_schedule_request.sql` — schedule-request flag
8. `009_brief_attachments.sql` — denormalised reference link/file columns on leads and sessions
9. `010_uploaded_files_telegram_metadata.sql` — Telegram file-id + filename/mime/kind on uploaded_files
10. `011_reference_links_table.sql` — normalised `reference_links` table for the dropzone
11. `012_reference_links_session_nullable.sql` — allow `reference_links.session_id` to be null (for admin-tagged links)

## Intake flow

The widget captures a project brief in a persistent left rail alongside the chat. The chat is fully LLM-driven — there are no preset quick-replies. The LLM extracts structured fields across multiple turns using the `record_brief_updates` tool, accumulates additional project context into a `projectScope` field, and ends brief-mode replies with a follow-up question for the next missing field.

- The persistent left rail (`ReviewPanel`) is visible from the moment the visitor signals project intent. It shows a progress strip, the eight reviewable fields (project scope, project type, service, timeline, budget, contact name, company, email), and a Send-to-team CTA. Every field is click-to-edit, even when unfilled.
- The rail's CTA is **always visible** — labelled "Send to team" in essentials mode and "Approve & send to team" in summary mode — and is disabled until all eight fields are filled. Clicking it is the only action that calls `POST /api/leads/finalize` and forwards to Telegram + Supabase. After send, the widget confirms the brief is approved, shows the Telegram broadcast status, and offers options to book a catch-up or talk to a human.
- Reference attachments live in an attachments popover above the chat input bar. Leads can paste a YouTube, Vimeo, Figma, Loom, or Google Drive URL (classified automatically), persisted via `POST /api/attachments/link` into `reference_links`, or upload reference files via `POST /api/telegram/upload` (Telegram hosts the file; we keep the `telegram_file_id`). The popover is opt-in — the rail shows a clean "no attachments yet" hint when the list is empty.

The widget also answers general questions about Balance, drafts Balance job-application material, and falls back to local responses when the LLM is unavailable. Out-of-scope requests (homework, recipes, roleplay, etc.) are declined and the user is pointed back to the three in-scope paths.
