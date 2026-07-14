# Deletion State Batched Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Coordinate private upload creation with deletion and clean every attachment before completing deletion.

**Architecture:** Add a database-owned session deletion state plus RPCs that atomically reserve upload cleanup obligations and begin deletion. Page the deletion worker over stored metadata and recovery rows, while database guards prevent session deletion and completion until no obligations remain.

**Tech Stack:** Next.js route handlers, Supabase/PostgreSQL migrations, Vitest, TypeScript.

---

### Task 1: Database deletion ownership

**Files:**
- Create: `supabase/migrations/043_deletion_state_batched_cleanup.sql`
- Test: `tests/integration/database-schema.test.ts`

1. Write DB-gated race and >1,000-row cleanup tests.
2. Run `npm run test:db -- --runInBand` and confirm the cases fail because the RPC/state does not exist.
3. Add the state, guarded reservation/deletion/completion functions, and indexes.
4. Run the DB tests and confirm they pass.

### Task 2: Upload reservation

**Files:**
- Modify: `lib/uploads/private-storage.ts`
- Test: `tests/uploads/private-storage.test.ts`

1. Write a failing test that storage is never called when DB reservation rejects a deleting session.
2. Run the focused Vitest test and confirm it fails.
3. Replace the direct recovery insert with the guarded RPC.
4. Run the focused test and confirm it passes.

### Task 3: Worker pagination

**Files:**
- Modify: `app/api/internal/deletion-worker/route.ts`
- Modify: `tests/api/deletion-worker.test.ts`

1. Write failing race and keyset pagination worker tests.
2. Run the focused worker suite and confirm it fails.
3. Call the database start/guard functions and drain each bounded page before session deletion.
4. Run the focused worker suite and confirm it passes.

### Task 4: Verification and commit

1. Run focused tests, full relevant suite, `npx tsc --noEmit`, and inspect `git diff --check`.
2. Commit the implementation as `fix: coordinate deletion with attachment cleanup`.
