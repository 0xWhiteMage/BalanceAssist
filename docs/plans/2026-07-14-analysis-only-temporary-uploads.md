# Analysis-Only Temporary Uploads Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store analysis-consented attachments privately, extract bounded text from their validated server-side bytes, and apply the safe result only to the temporary draft.

**Architecture:** The private-storage module owns live storage attestation, validation, opaque persistence, and deletion. The route coordinates analysis consent, atomic batch compensation, extraction, and response serialization. The widget independently controls file-analysis consent and forwards only server-returned analysis text to the draft callback.

**Tech Stack:** Next.js route handlers, React, TypeScript, Vitest, Supabase server client.

---

### Task 1: Test And Implement Live Storage Attestation

**Files:**
- Modify: `tests/uploads/private-storage.test.ts`
- Modify: `lib/uploads/private-storage.ts`

1. Add a failing test that a policy/readiness drift at upload time rejects storage.
2. Run `npm test -- tests/uploads/private-storage.test.ts` and observe the expected failure.
3. Replace the stale readiness snapshot check with a current fail-closed attestation.
4. Re-run the focused test file and confirm it passes.

### Task 2: Test And Implement Analysis And Compensation

**Files:**
- Modify: `tests/api/private-upload-route.test.ts`
- Modify: `app/api/telegram/upload/route.ts`
- Modify: `lib/uploads/private-storage.ts`

1. Add failing route tests for validated-byte extraction, opaque results, validation rejection, readiness failure, and batch compensation.
2. Run `npm test -- tests/api/private-upload-route.test.ts` and observe failures.
3. Add the minimal route/storage APIs to validate once, extract bounded text, and compensate successful earlier stores after a later failure.
4. Re-run the focused route tests and confirm they pass.

### Task 3: Test And Implement File UI Consent And Draft Callback

**Files:**
- Modify: `tests/widget/attachment-dropzone.test.tsx`
- Modify: `components/widget/attachment-dropzone.tsx`
- Modify: `components/widget/widget-overlay.tsx`

1. Add failing tests that files require only analysis consent, producer consent remains link-only, and server analysis invokes the draft callback.
2. Run `npm test -- tests/widget/attachment-dropzone.test.tsx` and observe failures.
3. Remove producer copy/control from the file UI, preserve it for links, and call the callback using the safe server response.
4. Re-run the focused widget tests and confirm they pass.

### Task 4: Update Documentation And Verify

**Files:**
- Modify: `README.md`
- Modify: `docs/private-attachment-storage.md`
- Test: focused upload/widget suites

1. Update documentation to state that files are retained only to analyse the current draft and never sent to the team.
2. Run focused tests, `npx tsc --noEmit`, and the full relevant test suite.
3. Inspect `git diff --check` and `git diff`.
4. Commit with `feat: analyse temporary attachments privately`.
