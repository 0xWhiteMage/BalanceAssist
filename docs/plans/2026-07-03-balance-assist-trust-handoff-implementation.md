# Balance Assist Trust-Handoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Balance Assist consistent with the thesis trust model by hard-separating AI intake from human support, stabilizing one-topic-per-session Telegram routing, improving Telegram formatting/topic labeling, and tightening memory, summaries, and Supabase hygiene.

**Architecture:** Keep one Next.js app with API routes, Supabase persistence, Deepseek intake chat, and Telegram relay. AI mode owns structured intake, summaries, memory, and guardrails. Human mode owns only delivery-state UX and Telegram transport. Sessions remain the root object, with Telegram topic metadata attached server-side.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Telegram Bot API, Deepseek API, Vitest, Playwright.

---

### Task 1: Add missing session metadata for trust and topic lifecycle

**Files:**
- Create: `supabase/migrations/005_session_topic_state.sql`
- Modify: `lib/db/schema.ts`
- Test: `tests/api/contracts.test.ts`

**Step 1: Write the migration**

Add columns needed for server-side lifecycle and naming:

```sql
alter table public.sessions
  add column if not exists human_mode boolean default false,
  add column if not exists topic_status text default 'new',
  add column if not exists last_delivery_status text,
  add column if not exists last_team_reply_at timestamptz;
```

**Step 2: Update TS schema helpers**

Extend `SessionRecord` with the newly tracked fields so route code has a typed shape.

**Step 3: Run local tests**

Run: `npm test -- tests/api/contracts.test.ts`

**Step 4: Commit**

```bash
git add supabase/migrations/005_session_topic_state.sql lib/db/schema.ts tests/api/contracts.test.ts
git commit -m "feat: add session topic lifecycle fields"
```

### Task 2: Make AI mode explicitly trust-aligned

**Files:**
- Modify: `lib/conversation/system-prompt.ts`
- Modify: `lib/conversation/local-responses.ts`
- Modify: `lib/conversation/flow.ts`
- Test: `tests/conversation/extract.test.ts`

**Step 1: Tighten the system prompt**

Add explicit behavior requirements:
- always identify as AI
- summarize after each section
- explain why sensitive questions are asked
- never make commercial commitments
- offer memory transparency commands

**Step 2: Add reusable trust-pattern responses**

Expand local responses for:
- uncertainty
- budget rationale
- timeline rationale
- memory inspection
- reset confirmation

**Step 3: Replace remaining rigid prompts**

Ensure intro and follow-ups are guidance-oriented rather than form-like.

**Step 4: Run tests**

Run: `npm test -- tests/conversation/extract.test.ts`

**Step 5: Commit**

```bash
git add lib/conversation/system-prompt.ts lib/conversation/local-responses.ts lib/conversation/flow.ts tests/conversation/extract.test.ts
git commit -m "feat: align AI intake prompts to trust model"
```

### Task 3: Add explicit memory inspection and reset paths

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `lib/api/client.ts`
- Modify: `app/api/events/route.ts`
- Test: `tests/widget/widget-page.test.tsx`

**Step 1: Add memory commands in widget logic**

Detect commands like:
- `What do you remember about my project?`
- `Forget this project`
- `Update that`

**Step 2: Render compact memory summaries**

Show stored facts from the current draft in a compact card-like message.

**Step 3: Log trust-relevant events**

Emit events such as:
- `memory_inspected`
- `memory_reset_requested`
- `memory_correction_requested`

**Step 4: Test widget rendering**

Run: `npm test -- tests/widget/widget-page.test.tsx`

**Step 5: Commit**

```bash
git add components/widget/widget-overlay.tsx lib/api/client.ts app/api/events/route.ts tests/widget/widget-page.test.tsx
git commit -m "feat: add transparent project memory controls"
```

### Task 4: Replace soft handoff with a hard human-support state machine

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `lib/conversation/types.ts`
- Test: `tests/smoke/app-shell.test.tsx`

**Step 1: Add explicit human-support states**

Represent:
- connected
- delivered
- awaiting_reply
- replied

**Step 2: Remove any AI fallback in human mode**

Ensure no LLM or local AI response can appear once human mode is active.

**Step 3: Improve CTA**

Make `Talk to a human` a primary action with icon styling, and remove the inline Telegram option from the handoff choice UI.

**Step 4: Add delivery-state copy**

Use short messages:
- `Connected to Balance team`
- `Message delivered to team`
- `Awaiting reply`
- `Replied by team`

**Step 5: Run test**

Run: `npm test -- tests/smoke/app-shell.test.tsx`

**Step 6: Commit**

```bash
git add components/widget/widget-overlay.tsx lib/conversation/types.ts tests/smoke/app-shell.test.tsx
git commit -m "feat: harden human support mode"
```

### Task 5: Stabilize one-topic-per-session creation

**Files:**
- Modify: `app/api/telegram/relay/route.ts`
- Modify: `app/api/telegram/webhook/route.ts`
- Modify: `lib/telegram.ts`
- Test: `tests/api/sessions-route.test.ts`

**Step 1: Add explicit fetch/insert error logging**

Every branch must log whether:
- session lookup failed
- topic creation failed
- thread claim race was lost
- DB insert failed

**Step 2: Keep atomic thread claiming**

Retain the conditional update strategy and ensure it is the only place that decides topic ownership.

**Step 3: Keep message persistence even on topic fallback**

Never return before trying to persist the outbound user message.

**Step 4: Verify webhook matching order**

Priority:
1. `message_thread_id`
2. `reply_to_message_id`
3. latest user session fallback

**Step 5: Run test suite**

Run: `npm test -- tests/api/sessions-route.test.ts`

**Step 6: Commit**

```bash
git add app/api/telegram/relay/route.ts app/api/telegram/webhook/route.ts lib/telegram.ts tests/api/sessions-route.test.ts
git commit -m "fix: stabilize one-topic-per-session relay"
```

### Task 6: Apply Telegram formatting best practices

**Files:**
- Modify: `app/api/telegram/relay/route.ts`
- Modify: `lib/conversation/topic-status.ts`

**Step 1: Standardize outbound Telegram message shape**

Use HTML parse mode only.

Format each relay message as:

```html
<b>📨 Sender Label</b>

<blockquote>User message body</blockquote>

<code>short-id</code>
```

**Step 2: Standardize topic labels**

Use:
- `🆕 Name / Company (ShortID)`
- `✅ Name / Company (ShortID)`
- `⏳ Name / Company (ShortID)`
- `🚫 Name / Company (ShortID)`
- `❌ Name / Company (ShortID)`

**Step 3: Keep within Telegram limits**

- topic names <= 128 chars
- body <= 4096 chars

**Step 4: Commit**

```bash
git add app/api/telegram/relay/route.ts lib/conversation/topic-status.ts
git commit -m "feat: apply Telegram formatting and topic labeling standards"
```

### Task 7: Update topics when qualification result becomes known

**Files:**
- Modify: `app/api/leads/finalize/route.ts`
- Modify: `lib/conversation/topic-status.ts`

**Step 1: Map qualification statuses to topic status**

Map:
- qualified -> `✅`
- needs_review -> `⏳`
- misfit -> `🚫`
- unqualified -> `❌`

**Step 2: Rename and recolor the Telegram topic**

When `telegram_thread_id` exists, call `editForumTopic` with:
- latest contact name/company
- status-specific icon color

**Step 3: Commit**

```bash
git add app/api/leads/finalize/route.ts lib/conversation/topic-status.ts
git commit -m "feat: sync topic status with lead qualification"
```

### Task 8: Improve Supabase hygiene and delivery-state observability

**Files:**
- Modify: `app/api/sessions/route.ts`
- Modify: `app/api/telegram/relay/route.ts`
- Modify: `app/api/telegram/messages/route.ts`
- Modify: `components/widget/widget-overlay.tsx`

**Step 1: Keep lazy session creation**

Only create a session when there is real engagement.

**Step 2: Keep `persisted` response flags**

Routes should expose whether data really hit Supabase.

**Step 3: Surface delivery states in UI**

If a relay message is sent successfully:
- show `Message delivered to team`

If polling finds nothing yet:
- show `Awaiting reply`

If polling finds a team reply:
- show `Replied by team`

**Step 4: Commit**

```bash
git add app/api/sessions/route.ts app/api/telegram/relay/route.ts app/api/telegram/messages/route.ts components/widget/widget-overlay.tsx
git commit -m "feat: surface delivery state and strengthen persistence hygiene"
```

### Task 9: Maintenance endpoints for Telegram topic cleanup

**Files:**
- Modify: `app/api/telegram/cleanup-topics/route.ts`
- Modify: `app/api/telegram/list-topics/route.ts`
- Modify: `README.md`

**Step 1: Keep authenticated topic maintenance**

Use `SETUP_TOKEN` protection.

**Step 2: Document cleanup workflow**

Explain how to:
- list live thread IDs from sessions
- find orphaned thread IDs from message rows
- delete orphaned topics

**Step 3: Commit**

```bash
git add app/api/telegram/cleanup-topics/route.ts app/api/telegram/list-topics/route.ts README.md
git commit -m "docs: document Telegram topic cleanup workflow"
```

### Task 10: Final verification

**Files:**
- Verify only

**Step 1: Run lint**

Run: `npm run lint`

**Step 2: Run unit tests**

Run: `npm test`

**Step 3: Run production build**

Run: `npm run build`

**Step 4: Manual smoke test**

Test in deployed widget:
- AI introduction identifies Balance Assist as AI
- summaries appear after sections
- human mode enters immediately
- first human message creates exactly one topic
- subsequent human messages reuse it
- topic renames when name/company is learned
- topic updates after final qualification
- no duplicate team messages

**Step 5: Commit any final doc or config-only adjustments**

```bash
git add .
git commit -m "chore: finalize trust-aligned handoff flow"
```
