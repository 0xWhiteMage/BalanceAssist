# Durable Deletion Processing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Process authenticated deletion requests as durable, observable, object-first deletion jobs within 24 hours.

**Architecture:** A forward migration defines the PII-free job state machine and token-checked RPCs for idempotent requests, claims, completion, failures, and final session deletion. An internal worker owns the private-storage cleanup loop and invokes the final RPC only after storage and recovery rows are clear. GitHub Actions schedules and monitors the worker every five minutes.

**Tech Stack:** Next.js route handlers, Supabase/PostgreSQL RPCs, Supabase Storage, Vitest, GitHub Actions.

---

### Task 1: Durable Job Schema

**Files:**
- Create: `supabase/migrations/038_durable_deletion_jobs.sql`
- Test: `tests/privacy/durable-deletion-migration.test.ts`

**Step 1:** Write migration-contract tests for PII-free columns, job states, active-job uniqueness, lease-aware claim, retry/failure, completion, and cascade deletion RPCs.

**Step 2:** Run `npm test -- tests/privacy/durable-deletion-migration.test.ts`; verify failures because the migration is absent.

**Step 3:** Implement the additive schema and RPCs with opaque UUID job IDs and token ownership checks.

**Step 4:** Re-run the focused test; verify it passes.

### Task 2: Authenticated Route And Worker

**Files:**
- Modify: `app/api/projects/[sessionId]/delete/route.ts`
- Create: `app/api/internal/deletion-worker/route.ts`
- Create: `lib/privacy/deletion-jobs.ts`
- Test: `tests/api/project-delete.test.ts`
- Test: `tests/api/deletion-worker.test.ts`

**Step 1:** Add failing handler tests for authenticated canonical job creation/status, idempotency, unauthenticated rejection, lease ownership, retry status, and PII-free responses/logs.

**Step 2:** Run both focused test files and verify the new cases fail.

**Step 3:** Implement the minimal typed route/worker adapters around the RPC contract.

**Step 4:** Re-run focused tests and verify they pass.

### Task 3: Private Storage Object-First Cleanup

**Files:**
- Modify: `lib/uploads/private-storage.ts`
- Test: `tests/uploads/private-storage.test.ts`
- Test: `tests/api/deletion-worker.test.ts`

**Step 1:** Add failing tests that known stored and recovery objects are removed before rows, failures defer final deletion, and a retry resumes safely.

**Step 2:** Run the focused tests and verify failures.

**Step 3:** Implement deletion-job cleanup that scans only job-owned session metadata, removes objects before rows, and returns an incomplete result on any uncertain cleanup.

**Step 4:** Re-run focused tests and verify they pass.

### Task 4: Scheduler And Documentation

**Files:**
- Create: `.github/workflows/deletion-worker.yml`
- Modify: `supabase/migrations/037_scheduler_health.sql`
- Modify: `app/api/internal/scheduler-health/route.ts`
- Modify: `README.md`
- Modify: `docs/temporary-session-retention.md`
- Create: `docs/deletion-processing-runbook.md`
- Test: `tests/api/scheduler-health.test.ts`
- Test: `tests/integration/release-workflow.test.ts`

**Step 1:** Add failing workflow/health tests for the five-minute GitHub worker, heartbeat, and deletion backlog contract.

**Step 2:** Run focused tests and verify failures.

**Step 3:** Add the workflow, health fields, and 24-hour SLA/privacy/runbook disclosures.

**Step 4:** Re-run focused tests and verify they pass.

### Task 5: Full Verification And Commit

**Files:** All modified files.

**Step 1:** Run the focused deletion, storage, scheduler, and migration tests.

**Step 2:** Run `npm test`, `npx tsc --noEmit`, and eligible database tests; record any Docker-dependent skip.

**Step 3:** Inspect `git diff --check`, `git diff`, and `git status --short`.

**Step 4:** Commit exactly the intended files with `feat: process deletion requests durably`.
