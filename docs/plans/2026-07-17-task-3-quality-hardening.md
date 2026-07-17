# Task 3 Quality Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent stale or malformed canonical draft application across chat and widget operations and emit final-stage recaps exactly once.

**Architecture:** Reload authenticated canonical state after provider no-op turns and compare versions before responding. Validate draft API payloads at runtime, bind widget operations to session generations and monotonic versions, and derive recaps from completed-stage counts.

**Tech Stack:** Next.js route handlers, React 19 hooks, TypeScript, Zod, Vitest, Testing Library

---

### Task 1: Authoritative No-Op Chat

**Files:**
- Modify: `tests/api/chat-route.test.ts`
- Modify: `app/api/chat/route.ts`

1. Add a deferred provider test where the session draft changes during provider execution and assert a 409 conflict with the latest draft.
2. Add a no-op test asserting the returned canonical state comes from a post-provider session reload.
3. Run the focused route tests and confirm both fail for stale pre-provider behavior.
4. Add a post-provider authenticated reload in the unchanged-draft path and compare its version with the prompt version.
5. Run the focused route tests and confirm they pass.

### Task 2: Strict Project-Draft Runtime Schemas

**Files:**
- Modify: `tests/api/client.test.ts` or the existing project-draft client test file
- Modify: `lib/api/client.ts`

1. Add table-driven malformed GET 200, PUT 200, and PUT 409 response tests.
2. Run the focused client tests and confirm malformed payloads are currently coerced into canonical state.
3. Add strict Zod schemas for versioned draft fields, reference links, approval metadata, and update response status variants.
4. Parse before flattening and return null or `{ ok: false, conflict: false }` on failure.
5. Run the focused client tests and confirm they pass.

### Task 3: Session-Bound Monotonic Widget Operations

**Files:**
- Modify: `tests/widget/widget-state-controllers.test.tsx`
- Modify: `tests/widget/widget-overlay-intent.test.tsx` or the closest operation lifecycle test
- Modify: `components/widget/use-widget-session-draft.ts`
- Modify: `components/widget/widget-overlay.tsx`

1. Add deferred tests for reset, session replacement, unmount, and out-of-order versions across `applyChatDraft`, `updateDraft`, and manual overlay edits.
2. Add an approval regression test for an identical same-version chat canonical response.
3. Run focused widget tests and confirm late results mutate state or emit messages.
4. Add operation tokens containing generation and session identity to the hook.
5. Invalidate tokens on reset, replacement, explicit invalidation, and unmount; require nondecreasing result versions.
6. Route overlay manual edits through the hook and gate chat canonical application and messages with the captured token.
7. Make same-version identical canonical application a no-op.
8. Run focused widget tests and confirm they pass.

### Task 4: Completed-Stage Recaps

**Files:**
- Modify: `tests/conversation/intake-stage.test.ts`
- Modify: `tests/api/chat-route.test.ts`
- Modify: `lib/conversation/intake-stage.ts`
- Modify: `app/api/chat/route.ts`

1. Add tests for completed-stage counts, final references/contact completion, and no duplicate recap on a no-op turn.
2. Run focused tests and confirm the final recap is missing under index slicing.
3. Implement `getCompletedIntakeStageCount` from each stage's completion requirements.
4. Slice newly completed stages by prior/current completed counts.
5. Run focused tests and confirm exact-once final recap behavior.

### Task 5: Verification And Commit

**Files:**
- Review all modified files.

1. Run all focused Task 3 tests.
2. Run all relevant API, conversation, and widget tests.
3. Run `npm test`.
4. Run `npx tsc --noEmit`.
5. Run `npm run lint`.
6. Run `git diff --check` and review the complete diff.
7. Commit only the intended files with a concise repository-style message.
