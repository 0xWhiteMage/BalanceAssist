# Balance Assist — Tool-Calling + Brief Edge Tab + Review Screen Design

## Goal

Replace the prose `:::draft:::` channel with Deepseek's tool-calling so structured brief updates can never truncate or leak. Replace the inline "Show project brief" button with an edge-tab slide-out panel. Force the AI to ask the user to verify the side panel before sending the brief to the team. Add reference links and brief-deck uploads, with files proxied to Telegram (Supabase keeps metadata only).

## Decisions Locked With User

1. **Tool shape.** Single tool `record_brief_updates` with all fields. Server validates with Zod. Model emits only changed fields.
2. **Strictness.** Tool output is the only source of truth in the happy path. The existing `:::draft:::` prose parser remains as a defensive fallback only.
3. **Telegram-first uploads.** Server proxies each uploaded file to `bot.sendDocument`. Supabase stores metadata only (URL/file_id, name, size, mime). No Supabase Storage.
4. **Review gate.** The AI must end its turn with a literal review prompt when the brief is reviewable. The user opens the panel via the edge tab and approves there.
5. **Brief panel trigger.** Edge tab anchored on the chat's right side. Slide-out over chat. No "Show project brief" text label.
6. **Human handoff.** `Talk to a human` button remains. Approval gate can be bypassed when the user is already connected to the team.

## Architecture

### Server

- `app/api/chat/route.ts`
  - Calls Deepseek with `tools: [{ type: 'function', function: { name: 'record_brief_updates', parameters: <zod-to-json-schema> } }]`.
  - Visible reply is `choices[0].message.content` (truncated safely).
  - Draft updates come from `choices[0].message.tool_calls[0].function.arguments`.
  - Falls back to the existing prose parser only if the model emits no tool call.
  - New `max_tokens`: 1024 for the visible reply and tool call, plus `temperature: 0.4` to reduce verbosity.
- `app/api/chat/route.ts` returns `{ message, draftUpdates, briefReady, reviewPrompt }`.
- `lib/conversation/tool-schema.ts` (new) — Zod schema mirroring `LeadDraft`, plus `referenceLinks: string[]` and `referenceFiles: { kind: 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive' | 'other', url: string }[]`.
- `lib/conversation/reply-sanitize.ts` — accepts tool output as the primary path; retains tolerant prose parser only for fallback.
- `lib/conversation/system-prompt.ts` — rewritten to require tool use on field changes, forbid re-asking filled fields, forbid meta-commentary, and emit the exact review-prompt string when `briefReady === true`.
- `lib/conversation/review-state.ts` (new) — exports `isBriefReadyForApproval(draft)`, `REVIEW_PROMPT`, `MISSING_FIELDS`.
- `app/api/telegram/upload/route.ts` — accepts multipart, streams to `bot.sendDocument`, persists metadata only.
- `lib/uploads/url-detect.ts` (new) — classifies pasted URLs into YouTube/Vimeo/Figma/Loom/Google Drive/other.
- Supabase migration `009_brief_attachments.sql` — adds `reference_links jsonb`, `reference_files jsonb` to `leads` and `sessions`.
- `app/api/leads/finalize/route.ts` — sends `referenceLinks` and `referenceFiles` into `leads.lead_draft` so the Telegram topic summary includes them.

### Client

- `components/widget/widget-overlay.tsx`
  - Drops the `showBriefPanel` boolean + "Show project brief" button.
  - Adds `briefPanelOpen: boolean` and `briefPanelFirstReady: boolean` for the one-shot pulse.
  - Renders `<BriefPanelTab />` on the chat's right edge.
  - When `briefReady && !briefPanelFirstReady`, sets `briefPanelFirstReady = true` and triggers a 1.2s pulse on the tab.
  - The chat text input no longer changes when the panel opens.
- `components/widget/widget-overlay-parts.tsx`
  - New `BriefPanelTab` — 14px-wide vertical tab, hover/focus states per the design tokens, animated chevron.
  - New `BriefReviewScreen` — focused review pane with all fields + attachments list + single primary CTA **Send to Balance team**.
  - New `AttachmentDropzone` — drag-drop zone + URL paste input. On submit, calls `/api/telegram/upload` or `/api/attachments/link`.
- `components/widget/widget-overlay.tsx` also adds `handleReferenceLinkSubmit(url)` and `handleReferenceFileSubmit(file[])`.
- `components/chat/message-bubble.tsx` — adds an inline chip rendering for already-attached files/links, so the chat shows what's been attached.

### Data Flow

1. User types in chat.
2. Widget POST `/api/chat` with `{ messages, context: { draft, step } }`.
3. Route calls Deepseek with `tools=[record_brief_updates]`.
4. Route validates tool-call arguments via Zod → runs `sanitizeDraftUpdates(...)` → returns `{ message, draftUpdates, briefReady, reviewPrompt }`.
5. Widget merges `draftUpdates` into local `draft` state.
6. If `briefReady` becomes true for the first time, the tab pulses once and the next LLM turn is forced to end with `REVIEW_PROMPT`.
7. User taps the edge tab → panel slides over chat → review screen renders.
8. User clicks **Send to Balance team** → POST `/api/leads/finalize` → Telegram topic renamed + summary posted (existing code, extended to include attachments).
9. Confirmation in chat: "Sent. The team will reach out within 1 business day."

### URL Detection Rules

`lib/uploads/url-detect.ts` returns:

- `youtube` — `youtube.com/watch?v=*`, `youtu.be/*`
- `vimeo` — `vimeo.com/*`
- `figma` — `figma.com/(file|proto|design)/*`
- `loom` — `loom.com/share/*`
- `gdrive` — `drive.google.com/*`, `docs.google.com/*`
- `other` — anything else with a `https?://` prefix
- `null` — not a URL

The brief card displays each link with a small badge (icon + service name) and a "remove" affordance.

### Review Prompt

`REVIEW_PROMPT = "Your brief is ready. Tap the tab on the right to review."`

The server injects this into the model context when `briefReady` becomes true. The model is instructed to end its visible turn with this exact string. The widget also renders a `BriefReviewScreen` with a single primary CTA.

### Edge Cases

- **Truncated visible reply.** Bump `max_tokens` to 1024. Add a server-side wrap detector (the model is told to end with `<<<END_REPLY>>>` if it must truncate, and the server strips the marker).
- **Tool-call with invalid args.** Treat as normal reply, log to events, do not apply updates.
- **URL pasted before any field is captured.** Allowed. Attachment appears in the panel immediately.
- **Drag-drop fails (size, mime).** Inline chip with error, no chat interruption.
- **Telegram upload fails.** Save metadata-only record in Supabase, mark `delivery_status='pending'`; the team can re-request.
- **User edits a field in the brief card.** Re-runs the local extractor and updates `scopePolished` only.
- **User approves while `isTeamConnected`.** Skip the AI approval gate; finalize immediately.
- **The tab is open when the user sends a chat message.** Tab stays open. Chat is hidden behind the panel.
- **The tab is open and the user clicks the close (×) on the tab.** Panel slides closed; chat is visible again.

## Testing

### Unit

- `tests/conversation/tool-schema.test.ts` — Zod schema accepts valid objects, rejects unknowns.
- `tests/conversation/reply-sanitize.test.ts` — tool-call path takes precedence over prose fallback.
- `tests/conversation/review-state.test.ts` — `isBriefReadyForApproval` returns true only when all required fields are filled.
- `tests/uploads/url-detect.test.ts` — YouTube/Vimeo/Figma/Loom/Google Drive/other/null classification.

### API

- `tests/api/chat-route.test.ts` — returns `{ message, draftUpdates, briefReady, reviewPrompt }` on tool calls.
- `tests/api/telegram-upload.test.ts` — proxies to Telegram, persists metadata only.

### Widget

- `tests/widget/brief-panel-tab.test.tsx` — opens/closes, pulse triggers once.
- `tests/widget/brief-review-screen.test.tsx` — renders fields + CTA.
- `tests/widget/attachment-dropzone.test.tsx` — URL paste and file drop paths.

### E2E (Playwright)

- `tests/e2e/intake.spec.ts` — natural-language intake updates the brief, opens the tab, approves, and verifies lead finalize + Telegram topic update.

## Commit Strategy

1. **Schema layer.** Add `lib/conversation/tool-schema.ts` + `tests/conversation/tool-schema.test.ts`. Build green.
2. **Prompt layer.** Rewrite `lib/conversation/system-prompt.ts` to require tool use + REVIEW_PROMPT. Update `tests/conversation/system-prompt.test.ts`. Build green.
3. **Route layer.** Switch `/api/chat` to Deepseek tool-calling with prose fallback. Update `tests/api/chat-route.test.ts` and `tests/conversation/reply-sanitize.test.ts`. Build green.
4. **Review-state layer.** Add `lib/conversation/review-state.ts` + tests.
5. **URL detection.** Add `lib/uploads/url-detect.ts` + tests.
6. **Schema migration.** `supabase/migrations/009_brief_attachments.sql` adds `reference_links jsonb`, `reference_files jsonb`.
7. **Upload pipeline.** Refactor `/api/telegram/upload` to proxy to Telegram; persist metadata only.
8. **Finalize lead.** Extend `/api/leads/finalize` to include attachments in the Telegram topic summary.
9. **Edge tab + review screen.** Replace `showBriefPanel` button with `BriefPanelTab`, add `BriefReviewScreen`, wire `briefReady` + `briefPanelFirstReady`. Tests.
10. **Attachment dropzone.** Add `AttachmentDropzone`, integrate with `/api/telegram/upload` and `/api/attachments/link`. Tests.
11. **E2E.** Add `tests/e2e/intake.spec.ts` covering the full flow.
12. **Doc.** Update README with the new flow.

Each commit ends with `npm run build` green and `npm test` green.

## Out of Scope (Explicit YAGNI)

- No new conversation steps.
- No redesign of the human-mode chat.
- No changes to the Telegram topic naming or status logic, beyond appending the attachments list.
- No new RLS policies beyond what the existing migration approach already uses.
- No mobile-specific tab layout (mobile takes over the full width by default; we will revisit if needed).
- No new service options or budget/timeline bands.
- No changes to `/api/schedule`, `/api/telegram/relay`, `/api/telegram/webhook`, `/api/telegram/messages`.