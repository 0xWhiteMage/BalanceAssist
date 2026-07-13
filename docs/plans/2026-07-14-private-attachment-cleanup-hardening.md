# Private Attachment Cleanup Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make private attachment retention fail closed without exposing session identifiers in object paths or recovery records.

**Architecture:** A new migration marks session-prefixed historical objects for durable cleanup rather than treating them as safe. The worker uses conservative, bounded session eligibility: any failed query, incomplete page, object deletion, or metadata transition defers that session. Storage readiness is set only after deterministic catalog checks prove direct privileges and policies cannot permit access.

**Tech Stack:** Next.js/TypeScript, Vitest, PostgreSQL/Supabase SQL migrations.

---

### Task 1: Define opaque keys and durable rollback failure handling

**Files:**
- Modify: `tests/uploads/private-storage.test.ts`
- Modify: `lib/uploads/private-storage.ts`

**Step 1: Write failing tests**

Assert generated keys are UUID-only and contain no session identifier. Assert a metadata failure followed by rollback and cleanup-record failures returns an explicit fail-closed error, with recovery metadata preserved through an atomic database RPC rather than a best-effort insert.

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/uploads/private-storage.test.ts`
Expected: FAIL because keys retain the session prefix and cleanup-record insertion is best effort.

**Step 3: Write minimal implementation**

Generate UUID-only object keys. Replace the unverified rollback cleanup insert with a fail-closed recovery operation whose error is distinguishable and whose persistence is durable.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/uploads/private-storage.test.ts`
Expected: PASS.

### Task 2: Make bounded expiry cleanup session-safe

**Files:**
- Modify: `tests/uploads/private-storage.test.ts`
- Modify: `lib/uploads/private-storage.ts`
- Modify: `app/api/cron/expire-sessions/route.ts`

**Step 1: Write failing tests**

Assert metadata query failure, bounded-page truncation, missing object identity, object-delete failure, and metadata-update failure defer every affected session. Assert a session is eligible only after every discovered object has been removed and marked cleaned.

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/uploads/private-storage.test.ts tests/api/session-expiry.test.ts`
Expected: FAIL because the current worker returns an empty deferral set on query failure and can purge unenumerated sessions.

**Step 3: Write minimal implementation**

Use per-session cleanup eligibility returned from a paginated/bounded query contract; conservatively defer on any incomplete or failed operation. Pass only eligible sessions to purge.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/uploads/private-storage.test.ts tests/api/session-expiry.test.ts`
Expected: PASS.

### Task 3: Add migration 031 cleanup state and provable Storage readiness

**Files:**
- Create: `supabase/migrations/031_private_attachment_cleanup_hardening.sql`
- Modify: `tests/uploads/private-storage-migration.test.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/integration/migration-history-source.test.ts`
- Modify: `scripts/apply-test-migrations.mjs`

**Step 1: Write failing source and integration tests**

Assert migration 031 retains no session identifier in recovery records, quarantines legacy path-shaped metadata as cleanup-required, revokes `PUBLIC`, `anon`, and `authenticated` direct privileges, removes policies deterministically by role/catalog scope, and records unavailable readiness when a safe policy proof cannot be made.

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/uploads/private-storage-migration.test.ts tests/integration/migration-history-source.test.ts && npm run test:db`
Expected: FAIL because migration 031 does not exist and migration 030 uses policy-text heuristics.

**Step 3: Write minimal migration and wiring**

Create migration 031 with cleanup-required legacy rows, guarded cleanup state transitions, deterministic policy removal/checks, and unavailable readiness on any uncertain storage catalog condition. Add it to the migration runner and integration schema expectations.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/uploads/private-storage-migration.test.ts tests/integration/migration-history-source.test.ts && npm run test:db`
Expected: PASS when the local integration database is available; otherwise report the environment blocker.

### Task 4: Update retention documentation and verify

**Files:**
- Modify: `README.md`
- Modify: affected tests and source from Tasks 1-3 only as required by failures

**Step 1: Write failing source test**

Assert migration history and README identify migration 031 and describe opaque key/recovery behavior without claiming readiness where it cannot be proven.

**Step 2: Run source test to verify it fails**

Run: `npm test -- tests/integration/migration-history-source.test.ts`
Expected: FAIL until docs and migration history are updated.

**Step 3: Update documentation**

Document UUID-only storage paths, cleanup-required legacy entries, fail-closed recovery, and deterministic readiness checks.

**Step 4: Verify and commit**

Run: `npm test`, `npx tsc --noEmit`, `git diff --check`, and `git diff --cached --check`.

Commit only task files with: `fix: fail closed private attachment cleanup`.
