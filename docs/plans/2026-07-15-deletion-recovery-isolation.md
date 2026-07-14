# Deletion Recovery Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scope private attachment recovery deletion to the claimed durable deletion job.

**Architecture:** Add an opaque nullable cleanup-owner UUID to recovery records, populate it from the session and copy it into a deletion job when requested, then filter deletion-worker cleanup and orphan completion by that UUID. Unowned legacy records remain deferred.

**Tech Stack:** Next.js route handlers, TypeScript, Supabase/PostgreSQL migrations, Vitest.

---

### Task 1: Specify Scoped Recovery Ownership

**Files:**
- Create: `supabase/migrations/042_deletion_recovery_ownership.sql`
- Test: `tests/privacy/durable-deletion-migration.test.ts`

**Step 1:** Add a migration-source test requiring nullable opaque `deletion_job_id`, safe backfill, and job-scoped orphan completion.

**Step 2:** Run the focused test and verify it fails because migration 042 is absent.

**Step 3:** Add the forward-only migration. Backfill only rows matched by an uploaded file and session; leave unknown rows null. Copy the opaque session owner to requested jobs and replace orphan completion with a job-owned existence check.

**Step 4:** Run the focused test and verify it passes.

### Task 2: Scope Worker Cleanup

**Files:**
- Modify: `app/api/internal/deletion-worker/route.ts`
- Test: `tests/api/deletion-worker.test.ts`

**Step 1:** Add a regression test asserting recovery selection is filtered by the claimed job ID.

**Step 2:** Run the focused test and verify it fails with the missing filter.

**Step 3:** Add the minimal job ID equality predicate.

**Step 4:** Run the focused test and verify it passes.

### Task 3: Create Owned Recovery Rows

**Files:**
- Modify: `lib/uploads/private-storage.ts`
- Test: `tests/uploads/private-storage.test.ts`

**Step 1:** Add a test that expects upload recovery creation to receive the session's deletion-job ownership.

**Step 2:** Run the focused test and verify it fails.

**Step 3:** Resolve the opaque session owner through a service-side RPC and include it in the recovery insert, failing safely if it cannot be resolved.

**Step 4:** Run the focused test and verify it passes.

### Task 4: Database Cross-Session Integration

**Files:**
- Modify: `tests/integration/database-schema.test.ts`

**Step 1:** Add an integration test creating two sessions, jobs, and owned recovery rows, then claim one job.

**Step 2:** Run the database test after migrations and verify it fails before scoped functions exist.

**Step 3:** Verify the migration implementation allows only the claimed job's record to be selected/deleted and completion ignores the other job's record.

**Step 4:** Run focused tests, full tests, TypeScript checking, review the diff, and commit `fix: isolate deletion recovery cleanup`.
