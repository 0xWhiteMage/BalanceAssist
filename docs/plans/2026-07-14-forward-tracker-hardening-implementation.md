# Forward Tracker Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver tracker security hardening to databases that have already recorded migration `018`.

**Architecture:** A new idempotent `035` migration owns tracker hardening. The custom migration runner keeps creating the tracker for fresh runs and continues reconciling Supabase CLI history before it applies project migrations.

**Tech Stack:** PostgreSQL SQL migrations, Node.js, Vitest, `pg`.

---

### Task 1: Specify Forward Upgrade Behavior

**Files:**
- Modify: `tests/integration/migration-history-source.test.ts`
- Modify: `tests/integration/database-schema.test.ts`

**Step 1:** Add source assertions requiring the `035` migration and inventory entry.

**Step 2:** Add a database-gated test that starts from a database migrated through `018`, applies the current chain, and checks tracker RLS and revoked `PUBLIC`, `anon`, and `authenticated` table privileges.

**Step 3:** Run the focused tests and confirm they fail because migration `035` is absent from the source and applied history.

### Task 2: Add The Forward Migration

**Files:**
- Create: `supabase/migrations/035_schema_migrations_tracker_hardening.sql`
- Modify: `README.md`

**Step 1:** Create `035` with `CREATE TABLE IF NOT EXISTS`, RLS enablement, and revocations for `PUBLIC`, `anon`, and `authenticated` guarded by role existence.

**Step 2:** Update each migration-chain inventory endpoint from `034` to `035`.

**Step 3:** Re-run the focused tests and confirm they pass.

### Task 3: Verify And Commit

**Files:**
- Verify all files above

**Step 1:** Run focused source and database-gated tests, then `npm test`, lint, TypeScript checking, and `git diff --check` where supported by the local environment.

**Step 2:** Inspect status and diff; do not modify unrelated existing worktree changes.

**Step 3:** Commit intended files with `fix: forward migrate tracker hardening`.
