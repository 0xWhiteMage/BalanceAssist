# Semantic Review Quality Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make semantic brief review, correction, private references, attribution, and reapproval truthful and retryable from durable canonical facts.

**Architecture:** Extend existing project/chat response contracts with visible provenance and complete reference rows, then centralize canonical edit/reference/approval outcomes in `useWidgetSessionDraft`. Keep rendering components controlled: `ReviewPanel` receives operation state and `ProjectBriefCard` owns only pending editor text and inline error presentation.

**Tech Stack:** React 19, TypeScript, Zod, Next.js route handlers, Supabase-backed versioned JSON drafts, Vitest/Testing Library, Playwright.

---

### Task 1: Preserve Canonical Provenance And Reference Identity

**Files:**
- Modify: `lib/api/contracts.ts`
- Modify: `lib/api/client.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/projects/[sessionId]/draft/route.ts`
- Modify: `components/widget/use-widget-session-draft.ts`
- Test: `tests/api/contracts.test.ts`
- Test: `tests/api/chat-client.test.ts`
- Test: `tests/api/chat-route.test.ts`
- Test: `tests/api/project-delete.test.ts`
- Test: `tests/widget/widget-state-controllers.test.tsx`

1. Write tests requiring visible provenance maps and retained reference IDs in project/chat responses and controller hydration.
2. Run focused tests and verify failures are caused by flattening/discarded IDs.
3. Add strict response schemas and preserve values plus provenance through canonical apply/conflict paths.
4. Run focused tests to GREEN.

### Task 2: Centralize Retryable Approval And Canonical Edit Outcomes

**Files:**
- Modify: `components/widget/use-widget-session-draft.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/review-panel.tsx`
- Test: `tests/widget/widget-state-controllers.test.tsx`
- Test: `tests/widget/widget-overlay-approve-idempotency.test.tsx`
- Test: `tests/widget/widget-overlay-approved-confirmation.test.tsx`

1. Write failing tests for `approved -> edit -> idle/reapproval -> approved`, reference invalidation, duplicate begin rejection, and stale completion.
2. Run focused tests to RED.
3. Implement typed edit outcomes and tokenized approval operation state; release locks on every terminal/invalidation path.
4. Drive `ReviewPanel` from controller operation state and remove its local approval lock.
5. Run focused tests to GREEN.

### Task 3: Make Row Editing Async, Retryable, And Accessible

**Files:**
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Test: `tests/widget/project-brief-card.test.tsx`
- Test: `tests/widget/review-panel.test.tsx`
- Test: `tests/widget/widget-overlay-session.test.tsx`

1. Write failing tests for pending duplicate suppression, retained text and `role=alert` on failure, Retry/Cancel, conflict replacement message, native Edit buttons, 44px controls, wrapping, and semantic groups.
2. Run focused tests to RED.
3. Make `onChange` return the typed Promise result and keep editor-local text until success/cancel.
4. Remove pointer-only row activation and group core/optional rows with headings and ARIA association.
5. Run focused tests to GREEN.

### Task 4: Add Inline Private Reference Management

**Files:**
- Modify: `components/widget/use-widget-session-draft.ts`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `lib/api/client.ts`
- Test: `tests/widget/project-brief-card.test.tsx`
- Test: `tests/widget/review-panel.test.tsx`
- Test: `tests/widget/widget-overlay-intent.test.tsx`
- Test: `tests/api/attachments-link.test.ts`

1. Write failing tests for inline Add, owned Remove, no producer-transfer consent, visible pending/errors/retry, and approval invalidation.
2. Run focused tests to RED.
3. Wire the existing private POST/DELETE client functions through the controller, retaining IDs and refreshing canonical metadata.
4. Render `Add reference link` / `Manage reference links` controls directly in Brief.
5. Run focused tests to GREEN.

### Task 5: Enforce Truthful Attribution, Readiness, And Transfer Copy

**Files:**
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `lib/conversation/flow.ts`
- Modify: `lib/conversation/system-prompt.ts`
- Modify: `lib/conversation/review-state.ts`
- Test: `tests/widget/project-brief-card.test.tsx`
- Test: `tests/widget/review-panel.test.tsx`
- Test: `tests/conversation/review-state.test.ts`
- Test: `tests/conversation/system-prompt.test.ts`
- Test: `tests/widget/widget-overlay-approved-confirmation.test.tsx`

1. Write failing tests for provenance-supported labels, neutral edited labels, `contact detail`, and no unproved review/follow-up promise.
2. Run focused tests to RED.
3. Derive labels from canonical provenance and map visible transfer copy only from persisted/queued/delivered facts.
4. Align scripted flow and prompt copy without changing internal integration contracts.
5. Run focused tests to GREEN.

### Task 6: Integrated Verification And Commit

1. Run all review/project/session/approval/widget Vitest suites.
2. Run impacted mobile E2E for Brief-tab editing and reference management.
3. Run `npm test`, `npx tsc --noEmit`, `npm run lint`, prohibited-copy search, and `git diff --check`.
4. Review `git status`, complete diff, and recent log; stage only intended files.
5. Commit with `fix: harden canonical brief review workflows`.
