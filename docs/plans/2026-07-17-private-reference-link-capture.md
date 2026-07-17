# Private Reference-Link Capture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decouple private session-owned reference-link capture from producer-transfer consent while preserving consent-gated finalization.

**Architecture:** The authenticated attachment-link route owns the private persistence boundary and relies on `requireSession` plus session-scoped insertion. The widget persists the link and canonical references status without changing consent state; the existing approval path remains the only producer-transfer transition in this flow.

**Tech Stack:** TypeScript, React 19, Next.js route handlers, Vitest, Testing Library.

---

### Task 1: API private link capture

**Files:**
- Modify: `tests/api/attachments-link.test.ts`
- Modify: `app/api/attachments/link/route.ts`

1. Change the no-grant regression to expect a successful session-owned insert and assert the consent ledger is never queried.
2. Run `npm test -- tests/api/attachments-link.test.ts` and verify the regression fails with HTTP 403.
3. Remove the producer-transfer lookup and rejection from the route.
4. Re-run the API test and verify it passes.

### Task 2: Widget private link capture

**Files:**
- Modify: `tests/widget/widget-overlay-intent.test.tsx`
- Modify: `components/widget/widget-overlay.tsx`

1. Update the typed-reference regression so the consent endpoint fails the test if called, while retaining assertions for link-first persistence and canonical `referencesStatus: "added"`.
2. Run the targeted widget test and verify it fails because capture calls the consent endpoint.
3. Remove the producer-transfer call from the references step while retaining session acquisition, URL classification, link persistence, status persistence, and error handling.
4. Re-run the targeted widget test and verify it passes.

### Task 3: Finalization gate and verification

**Files:**
- Verify: `tests/widget/widget-overlay-approved-confirmation.test.tsx`
- Verify: `tests/api/leads-finalize.test.ts`

1. Run the existing finalization regressions proving consent failure blocks the widget finalize call and the API returns `consent_required`.
2. Run all affected tests, then the full relevant suite.
3. Run TypeScript, lint, inspect the final diff, and commit only the intended files.
