# Authenticated Upload Parsing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Authenticate upload requests before bounded multipart parsing.

**Architecture:** The upload client provides its session ID in `x-session-id`, so the route can bind it to the existing capability before reading the multipart body. The route checks declared size and wraps unknown-length streams with a hard byte limit before calling `formData()`.

**Tech Stack:** Next.js route handlers, Web Streams, TypeScript, Vitest.

---

### Task 1: Prove unauthorized requests do not parse multipart data

**Files:**
- Modify: `tests/api/private-upload-route.test.ts`
- Modify: `app/api/telegram/upload/route.ts`

**Step 1:** Add tests for missing/invalid capability and untrusted origin which spy on `Request.prototype.formData` and expect no call.

**Step 2:** Run `npm test -- tests/api/private-upload-route.test.ts` and confirm the tests fail because the route parses first.

**Step 3:** Require `x-session-id`, then call `requireSession(request, sessionId)` before body parsing.

**Step 4:** Re-run the targeted test and confirm it passes.

### Task 2: Bound multipart input

**Files:**
- Modify: `tests/api/private-upload-route.test.ts`
- Modify: `app/api/telegram/upload/route.ts`

**Step 1:** Add declared-size and chunked oversize tests expecting `413`.

**Step 2:** Run the targeted test and confirm it fails.

**Step 3:** Check numeric `Content-Length` and pass a byte-limited request stream to `formData()`.

**Step 4:** Re-run the targeted test and confirm it passes.

### Task 3: Update callers and protect the valid flow

**Files:**
- Modify: `components/widget/attachment-dropzone.tsx`
- Modify: `lib/api/client.ts`
- Modify: `tests/api/private-upload-route.test.ts`

**Step 1:** Update upload clients to send `x-session-id` and add a valid analysis-only upload regression.

**Step 2:** Run the targeted test and confirm the client/route contract is satisfied.

### Task 4: Verify and commit

**Step 1:** Run `npm test -- tests/api/private-upload-route.test.ts tests/api/telegram-upload.test.ts tests/api/session-scoped-routes.test.ts`.

**Step 2:** Run `npx tsc --noEmit`.

**Step 3:** Inspect `git diff --check` and `git diff`.

**Step 4:** Commit implementation as `fix: authenticate uploads before parsing`.
