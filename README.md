# Balance Assist

AI-assisted project onboarding chatbot for Balance Studio. Embeds as a floating widget on the live site, talks to leads via Deepseek, and relays human handoff to Telegram in real time.

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