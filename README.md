# Balance Assist

AI-assisted project onboarding chatbot for Balance Studio. Embeds as a floating widget on the live site, talks to leads via Deepseek via tool calling, captures a structured brief behind a review screen, and relays human handoff to Telegram in real time.

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

## API endpoints

- `POST /api/sessions` — create a chat session
- `POST /api/events` — log analytics events
- `POST /api/leads/finalize` — save a qualified lead (skips empty drafts)
- `POST /api/chat` — Deepseek-backed chat completion
- `POST /api/telegram/relay` — forward a user message to the team's Telegram
- `GET /api/telegram/messages` — poll for new team replies
- `POST /api/telegram/webhook` — Telegram sends replies here
- `POST /api/telegram/setup` — one-call bot verification + webhook setup
- `POST /api/telegram/simulate` — dev-only: simulate a team reply
- `POST /api/telegram/upload` — file upload metadata only; the file itself is hosted by Telegram and referenced by `telegram_file_id`
- `POST /api/attachments/link` — persist a reference link (YouTube, Vimeo, Figma, Loom, Google Drive, other) for the current session

## Environment variables

```
# Supabase (server)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service-role>          # legacy
SUPABASE_SECRET_KEY=sb_secret_...                 # new format, preferred

# LLM
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-v4-flash

# Telegram relay
TELEGRAM_BOT_TOKEN=<from BotFather>
TELEGRAM_CHAT_ID=-100...

# Optional
CALENDLY_URL=https://calendly.com/<user>/<event>
SETUP_TOKEN=<random-secret>                       # protects /api/telegram/setup
```

## Deploy to production

### 1. Create a GitHub repo

```bash
# In the repo root
git remote add origin https://github.com/<your-username>/balance-assist.git
git push -u origin main
```

### 2. Connect Vercel to the GitHub repo

1. Go to https://vercel.com/new
2. Import the GitHub repo
3. Framework preset: **Next.js**
4. Add every environment variable from the table above
5. Click **Deploy**

Vercel will auto-deploy on every push to `main`.

### 3. Configure GitHub secrets

In the GitHub repo, go to **Settings → Secrets and variables → Actions** and add:

| Secret | Purpose |
|---|---|
| `PRODUCTION_URL` | Your deployed domain, e.g. `https://balance-assist.vercel.app` |
| `SETUP_TOKEN` | Same value as in Vercel env |
| `TELEGRAM_BOT_TOKEN` | Same as in Vercel env |

### 4. Verify the webhook

After the first deploy, the GitHub Action runs and calls `/api/telegram/setup` which points the bot at your production URL.

To check manually:
```bash
curl -X POST https://your-domain.com/api/telegram/setup \
  -H "Content-Type: application/json" \
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

Important: the team must use Telegram's **Reply** action (long-press → Reply) so the backend can match the reply to the right session.

## Local testing without a public webhook

Use the simulate endpoint to fake a team reply:
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

## Intake flow

The widget captures a project brief behind a deliberate two-step gate so leads see exactly what the team will receive before anything is sent.

- The chat surface walks the visitor through free-text and option steps. As soon as the Deepseek-backed `/api/chat` route confirms the draft is complete (via the `record_brief_updates` tool call), it returns `{ message, draftUpdates, briefReady, reviewPrompt }` and the widget merges the structured fields into the in-memory draft.
- A persistent left rail (the `ReviewPanel`) is always visible after the widget opens — it sits to the left of the chat so leads see the captured fields building up in real time.
- The brief rail has two modes. **Essentials** while the brief is incomplete (progress strip + captured fields, no CTA). **Summary** the moment the LLM signals `briefReady` and all 8 reviewable fields are captured; the rail then shows the primary CTA.
- When the brief is reviewable, the rail shows **Approve & send to team** as a one-click send — that's the only thing that hits `POST /api/leads/finalize` and forwards to Telegram + Supabase. Until the lead clicks it, nothing is persisted as a lead. After send, the widget confirms the brief is approved and offers options to continue refining, book a call, or talk to the team directly.
- Reference attachments live in an attachments popover above the chat input bar (z-index 100, closable on click-outside or ESC). Leads can paste a YouTube / Vimeo / Figma / Loom / Google Drive URL, persisted via `POST /api/attachments/link` into `reference_links`, or upload reference files (the widget uploads metadata only to `POST /api/telegram/upload`; Telegram hosts the file and we keep the `telegram_file_id`).

Attachments are not required; the dropzone is opt-in and the rail still shows a clean "no attachments yet" hint when the list is empty. The tool-calling path lets the LLM keep extracting structured fields across multiple turns without re-prompting the visitor for fields it already has.