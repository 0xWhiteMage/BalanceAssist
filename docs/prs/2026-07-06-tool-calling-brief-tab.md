## Summary

Replaces the fragile `:::draft:::` prose parser in the chat path with Deepseek tool-calling as the single source of truth for structured brief updates. Introduces an edge-tab slide-out (no inline "Show project brief" button), a focused review screen that gates finalization, and reference-link and file attachments — files are proxied to Telegram `bot.sendDocument` with metadata only persisted in Supabase.

## Why

1. **Truncation in production.** The previous intake flow cut off mid-reply because of `max_tokens` and a brittle hidden-line parser. Tool-calling is a structured channel that cannot be truncated by the model's output budget.
2. **Inline brief competed with the chat.** Users had no clear path to "review what the AI captured". The edge-tab slide-out keeps the chat primary and surfaces the brief only on intent.
3. **Missing first-class attachments.** Reference links (Figma, Loom, Drive, YouTube, Vimeo) and file uploads (PDF/PPTX/DOCX/images) were unavailable; producers had to ask for them in chat. They are now first-class fields.

## What this PR does

- Switches `app/api/chat/route.ts` to call Deepseek with `tools=[record_brief_updates]`. Visible text comes from `choices[0].message.content`; structured updates come from `choices[0].message.tool_calls[0].function.arguments` and are validated against a Zod schema.
- Reshapes the chat route response to `{ message, draftUpdates, briefReady, reviewPrompt, missingFields }`. The widget merges `draftUpdates` into local state, fires the edge-tab pulse when `briefReady` flips to true, and renders the review prompt only when all eight fields are present.
- Adds an edge-tab slide-out panel (`components/widget/brief-panel-tab.tsx`) — a 14px-wide vertical tab with a chevron only (no text label), ARIA-accessible, with a one-shot `pulse` animation.
- Adds a focused review screen (`components/widget/brief-review-screen.tsx`) with all eight fields, an attachments area, and a primary "Send to Balance team" CTA.
- Adds reference links via `classifyUrl` → `POST /api/attachments/link` → Supabase `reference_links` table.
- Adds file uploads via `POST /api/telegram/upload` → `bot.sendDocument` → metadata-only insert into `uploaded_files`. The finalize-lead route appends an attachment summary line to the Telegram topic.

## How

### Tool calling
`app/api/chat/route.ts` sends Deepseek a `tools` array containing `record_brief_updates`. The visible reply is `choices[0].message.content`. Structured updates live in `choices[0].message.tool_calls[0].function.arguments`, parsed and validated against the Zod schema in `lib/conversation/tool-schema.ts`. Failure modes — wrong tool name, malformed JSON, schema rejection — log a `console.warn` and fall back gracefully. The previous prose parser remains in `lib/conversation/reply-sanitize.ts` as a defensive fallback only; it is no longer on the chat hot path.

### Response shape
The chat route returns five keys:
- `message` — the user-facing reply text (existing behavior preserved).
- `draftUpdates` — partial or complete brief updates from the tool call (existing behavior preserved).
- `briefReady` — boolean; true once all eight required fields are present.
- `reviewPrompt` — message the widget renders when `briefReady` flips to true.
- `missingFields` — array of field names still pending.

The widget sets `briefPanelFirstReady = true` on the first `briefReady === true` transition, which fires the tab pulse.

### Edge tab
`components/widget/brief-panel-tab.tsx` — a 14px-wide vertical tab, no text label (chevron only). ARIA-accessible. One-shot `pulse` keyframe animation triggered by the `briefReady` transition. Resides in the widget layout, not in the chat panel.

### Review screen
`components/widget/brief-review-screen.tsx` — a focused review pane reached either by clicking the edge tab or by accepting the AI-driven review prompt. Lists all eight fields with their captured values, renders the attachments area, and exposes a primary "Send to Balance team" CTA that triggers finalization.

### Attachments
- **URL paste** → `classifyUrl` (provider detection) → `POST /api/attachments/link` → `reference_links` row.
- **File upload** → `POST /api/telegram/upload` → `bot.sendDocument` to the lead's topic → metadata-only insert into `uploaded_files` (no binary blob in Supabase).
- **Finalize** → the existing finalize-lead route appends a one-line attachment summary to the Telegram topic.

## Migrations

Three new Supabase migrations, all idempotent:

- `009_brief_attachments.sql` — adds `reference_links` / `reference_files` JSONB columns to `leads` and `sessions`.
- `010_uploaded_files_telegram_metadata.sql` — adds `telegram_file_id`, `name`, `mime`, `kind` columns to `uploaded_files`.
- `011_reference_links_table.sql` — creates the `reference_links` table that the link endpoint writes to.

## Tests

- 22 new test files, 22 new unit tests, 1 new Playwright E2E.
- `npm test`: **107/107 pass**.
- `npm run test:e2e`: **2/2 pass** (existing `widget.spec.ts` plus new `intake.spec.ts`).
- `npm run build`: green.

## Risk

- **Behavior change.** The previous prose parser is removed from the chat hot path. It still exists in `lib/conversation/reply-sanitize.ts` as a defensive fallback. Tool-validation failures log with `console.warn` for ops visibility. No existing widget callers depend on the old parser.
- **API additions only.** The chat route response shape is additive — 5 keys instead of the previous 2. Existing widget fields like `message` and `draftUpdates` are preserved.
- **Telegram as file host.** Files are now stored in Telegram; `uploaded_files` carries metadata only. This was a deliberate product decision: Telegram as the durable file host, Supabase as the structured-data store. Documents are append-only in the Telegram topic.

## Out of scope

- `/api/telegram/relay`, `/api/telegram/webhook`, `/api/telegram/messages`
- `/api/schedule`
- Human-mode chat
- Telegram topic naming and status changes
- RLS policies on the new tables

## Design and implementation docs

- Design: `docs/plans/2026-07-06-balance-assist-tool-calling-brief-tab-design.md`
- Implementation: `docs/plans/2026-07-06-balance-assist-tool-calling-brief-tab-implementation.md`

## Reviewer checklist

- [ ] Verify the chat route's response shape matches `{ message, draftUpdates, briefReady, reviewPrompt, missingFields }`.
- [ ] Verify the edge tab has no "Show project brief" text label.
- [ ] Verify the review screen is reachable via the tab, and the AI-driven review prompt only fires when all eight fields are present.
- [ ] Verify the attachment dropzone accepts URL and file uploads.
- [ ] Verify Supabase migrations 009–011 are non-destructive (`ADD COLUMN ... IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`).
- [ ] Confirm `npm test`, `npm run test:e2e`, and `npm run build` all pass on the branch.
