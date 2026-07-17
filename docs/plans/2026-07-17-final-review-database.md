# Final Review Database Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Release forward migration 055 through a hash-reviewed protected path and prove final-review persistence, payload, and approval-return behavior.

**Architecture:** Replace the existing finalization function in one forward SQL migration while retaining its established transaction and qualification internals. Protect that migration with an independent immutable artifact, runner, workflow, and ordinary-runner exclusion/prerequisite.

**Tech Stack:** PostgreSQL/PLpgSQL, Node.js ESM, Vitest, TypeScript, GitHub Actions, Supabase CLI

---

### Task 1: Specify Migration and Runtime Behavior

**Files:**
- Modify: `tests/integration/migration-runner.test.ts`
- Modify: `tests/integration/database-schema.test.ts`

**Step 1: Write failing tests**

Add migration-history assertions for 055 and DB-gated assertions that objective-only detail persists, the payload has all approved fields, and finalization returns the two hashes matching canonical reference semantics.

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/integration/migration-runner.test.ts tests/integration/database-schema.test.ts`
Expected: FAIL because migration 055 and its behavior do not exist.

### Task 2: Specify Protected Policy

**Files:**
- Create: `tests/integration/production-final-review-migration-policy.test.ts`
- Modify: `tests/integration/production-migration-policy.test.ts`

**Step 1: Write failing tests**

Require exact 055 source/artifact selection, hash rejection, immutable-main workflow execution, and ordinary-runner exclusion plus prerequisite.

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/integration/production-final-review-migration-policy.test.ts tests/integration/production-migration-policy.test.ts`
Expected: FAIL because the protected 055 path is absent.

### Task 3: Implement Migration 055

**Files:**
- Create: `supabase/migrations/055_final_review_approval.sql`

**Step 1: Implement minimal SQL**

Drop and recreate only `public.finalize_session_lead(uuid)`, append the approved hash columns, accept objective as project detail, add the payload fields, and calculate the compact canonical reference hash.

**Step 2: Run focused tests**

Run: `npm test -- --run tests/integration/migration-runner.test.ts tests/integration/database-schema.test.ts`
Expected: PASS, with DB-gated tests skipped only when their configured database is unavailable.

### Task 4: Implement Protected Release Path

**Files:**
- Create: `supabase/production-final-review-055.sql`
- Create: `scripts/apply-production-final-review-migration.mjs`
- Create: `scripts/apply-production-final-review-migration.d.mts`
- Create: `.github/workflows/production-final-review-migration.yml`
- Modify: `scripts/apply-production-migrations.mjs`

**Step 1: Add immutable artifact and runner**

Wrap the exact migration source with baseline checks, advisory locking, tracker insertion, and postconditions. Pin normalized source and artifact SHA-256 values in the dedicated runner.

**Step 2: Add workflow and ordinary-runner policy**

Require an immutable commit on main, use the protected approval environment and pinned CLI, execute only the 055 dry run and artifact, exclude 055 from ordinary selection, and require 055 recorded.

**Step 3: Run policy tests**

Run: `npm test -- --run tests/integration/production-final-review-migration-policy.test.ts tests/integration/production-migration-policy.test.ts`
Expected: PASS.

### Task 5: Verify and Commit

**Files:**
- Review all files above

**Step 1: Run policy and source tests**

Run the focused integration policy tests and migration source tests.
Expected: PASS.

**Step 2: Run TypeScript compilation**

Run: `npm run typecheck`
Expected: PASS.

**Step 3: Inspect release diff**

Run: `git status --short`, `git diff --check`, and `git diff --stat`.
Expected: only the coherent 055 release path and its tests/docs are changed.

**Step 4: Commit**

Stage only intended files and commit with a concise migration-release message. Do not run the production workflow or runner.
