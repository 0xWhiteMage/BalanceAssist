# Balance Assist AI-First Intake Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI mode fully Deepseek-first, keep a persistent live brief card, add an explicit approval gate before formal team handoff, and preserve human bypass as an immediate alternative.

**Architecture:** Deepseek becomes the primary response engine for all AI-mode user messages. The widget continues to maintain a structured draft in parallel, updating the Project Brief card from extracted fields. A new approval state gates formal AI-to-team handoff, but `Talk to a human` can still bypass approval and hand the current incomplete draft to the team.

**Tech Stack:** Next.js App Router, TypeScript, Deepseek API, Supabase, Telegram Bot API, Vitest.

---

### Task 1: Add explicit approval state to session and lead lifecycle

**Files:**
- Create: `supabase/migrations/009_brief_approval.sql`
- Modify: `app/api/leads/finalize/route.ts`
- Test: `tests/api/contracts.test.ts`

**Step 1: Write the migration**

Add approval tracking to sessions:

```sql
alter table public.sessions
  add column if not exists brief_approved boolean not null default false,
  add column if not exists handoff_reason text;
```

**Step 2: Extend the finalize route**

When AI-mode approval happens, `brief_approved` is set to true. When human bypass happens, store `handoff_reason = 'human_bypass'`.

**Step 3: Verify build/tests**

Run: `npm test -- tests/api/contracts.test.ts`

**Step 4: Commit**

```bash
git add supabase/migrations/009_brief_approval.sql app/api/leads/finalize/route.ts tests/api/contracts.test.ts
git commit -m "feat: add brief approval state"
```

### Task 2: Make AI mode fully LLM-first

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `app/api/chat/route.ts`
- Test: `tests/widget/widget-page.test.tsx`

**Step 1: Remove scripted-step-first behavior for AI mode**

All AI-mode user messages should route to `handleLLMResponse()` first. The scripted flow remains only as fallback and as a source of “what fields are missing,” not as the primary response engine.

**Step 2: Keep extraction in parallel**

After each user message, continue updating the draft via:
- local extractor
- server-returned `draftUpdates`

but do not let scripted step transitions dominate the visible reply.

**Step 3: Ensure the AI refers to the brief card**

The AI should guide the user based on missing fields rather than hardcoded step numbers.

**Step 4: Verify widget output**

Run: `npm test -- tests/widget/widget-page.test.tsx`

**Step 5: Commit**

```bash
git add components/widget/widget-overlay.tsx app/api/chat/route.ts tests/widget/widget-page.test.tsx
git commit -m "feat: make AI mode Deepseek-first"
```

### Task 3: Add a proper Project Brief review/approval step

**Files:**
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/widget-overlay.tsx`

**Step 1: Add approval controls to the brief card**

When enough fields are present, show:
- `Approve & send to team`
- `Continue refining`

“Enough fields” can be:
- project scope
- at least one of service/timeline/budget
- at least one contact method

**Step 2: Add explicit copy**

Show:
- what will be sent
- what is still missing

**Step 3: Wire the approval CTA**

Approval should:
- finalize the lead
- set `brief_approved = true`
- move into handoff-ready state

**Step 4: Commit**

```bash
git add components/widget/widget-overlay.tsx components/widget/widget-overlay-parts.tsx
git commit -m "feat: add explicit brief approval gate"
```

### Task 4: Preserve immediate human bypass

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `app/api/telegram/relay/route.ts`

**Step 1: Keep `Talk to a human` immediate**

Clicking the button should still switch to human mode immediately.

**Step 2: Mark draft as incomplete when bypassed**

Pass through the current structured draft and send a note to Telegram that the brief was handed off before approval.

**Step 3: Topic/message copy**

Telegram topic/message should indicate:
- `Draft incomplete`
- or `Human requested before final approval`

**Step 4: Commit**

```bash
git add components/widget/widget-overlay.tsx app/api/telegram/relay/route.ts
git commit -m "feat: preserve immediate human bypass with incomplete-brief labeling"
```

### Task 5: Improve brief-card completeness guidance

**Files:**
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/widget-overlay.tsx`

**Step 1: Highlight missing fields more clearly**

Use:
- unfilled state labels
- simple count (`4 of 7 fields captured`)
- one-line prompt like “To help the Balance team respond faster, fill the missing fields below.”

**Step 2: Let AI point at missing fields**

When fields are missing, AI should say things like:
- “I still don’t have your timeline.”
- “I can see the project scope, but I still need your best contact email.”

**Step 3: Commit**

```bash
git add components/widget/widget-overlay.tsx components/widget/widget-overlay-parts.tsx
git commit -m "feat: improve missing-field guidance in brief card"
```

### Task 6: Visual distinction between AI mode and human mode

**Files:**
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/widget-overlay.tsx`

**Step 1: Strengthen mode badges**

AI mode should clearly say:
- `Balance Assist`
- `AI assistant`

Human mode should clearly say:
- `Balance Studio Team`
- delivery/reply states only

**Step 2: Make iconography distinct**

Use:
- AI mode → logo plus `AI` indicator copy
- Human mode → logo plus team-state indicator

**Step 3: Commit**

```bash
git add components/widget/widget-overlay.tsx components/widget/widget-overlay-parts.tsx
git commit -m "feat: strengthen visual distinction between AI and human modes"
```

### Task 7: Final verification

**Files:**
- Verify only

**Step 1: Run lint**

Run: `npm run lint`

**Step 2: Run tests**

Run: `npm test`

**Step 3: Run production build**

Run: `npm run build`

**Step 4: Manual smoke test**

Verify in `/preview`:
- first user message uses Deepseek immediately
- no step-looping for off-topic or ambiguous messages
- brief card updates live
- approval gate appears when enough info exists
- `Talk to a human` still bypasses approval
- approved brief goes to team only after explicit action

**Step 5: Commit any final polish**

```bash
git add .
git commit -m "chore: finalize AI-first intake flow"
```
