# Protected Cleanup Migrations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a separately approved, one-time production path for reviewed destructive migrations `038` through `042`, without allowing arbitrary cleanup SQL or deploying the application.

**Architecture:** A dedicated migration runner selects only known filenames and versions, supports a dry-run inventory, applies them through the existing transactional migration tracker, then verifies the recorded versions. A manual GitHub Actions workflow validates an immutable lowercase SHA against `origin/main` before it can access the protected `production-cleanup-migrations` environment; it validates a fresh backup/audit attestation, runs dry-run and apply/verification, then health-smokes the already deployed application.

**Tech Stack:** GitHub Actions YAML, Node.js ESM, PostgreSQL via `pg`, Vitest, `yaml` parser, Markdown runbook.

---

### Task 1: Define and test the cleanup migration runner

**Files:**
- Create: `scripts/apply-production-cleanup-migrations.mjs`
- Create: `tests/integration/production-cleanup-migration-policy.test.ts`

**Step 1: Write the failing test**

Assert that the runner's allowlist is exactly versions `038` to `042`, its dry-run identifies those pending reviewed migrations, it rejects missing/renamed/extra migration versions, and its result records applied versions plus verified schema versions.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/production-cleanup-migration-policy.test.ts`

Expected: FAIL because the cleanup runner does not exist.

**Step 3: Write minimal implementation**

Export an allowlisted selection function and an apply function. Reuse `applyMigrations` only with a temporary directory containing the selected reviewed files so no unreviewed migration can run. Dry-run returns the selected pending filenames; apply reads `public.schema_migrations` and fails unless all five reviewed versions are recorded after execution.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/production-cleanup-migration-policy.test.ts`

Expected: PASS.

### Task 2: Add parsed-YAML workflow tests

**Files:**
- Modify: `tests/integration/release-workflow.test.ts`
- Create: `tests/integration/cleanup-migration-workflow.test.ts`

**Step 1: Write the failing test**

Parse the new workflow and assert manual dispatch only, required `ref` and `backup_audit_attestation` inputs, `production-cleanup-migrations` environment, pre-environment lowercase SHA/`origin/main` ancestry validation, exact attestation format and 24-hour freshness checks, `038`–`042` allowlist invocation, dry-run, recorded-version verification, post-migration `/api/health` smoke, and absence of Vercel deployment, alias, webhook, or app build/deployment commands.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/cleanup-migration-workflow.test.ts`

Expected: FAIL because the workflow does not exist.

**Step 3: Write minimal implementation**

Create `.github/workflows/production-cleanup-migrations.yml`. Validate the dispatch SHA before any environment is entered with the same shell controls and `origin/main` fetch/ancestry pattern as production release. Require `BACKUP_AUDIT_VERIFIED:<UTC ISO-8601 timestamp>` not future or older than 24 hours. In the sole protected job, checkout the validated SHA, run a dry run, apply, verify all recorded versions, record the versions in job summary, and smoke the existing production health URL. Do not invoke deployment, Vercel, alias, or webhook tooling.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/cleanup-migration-workflow.test.ts tests/integration/release-workflow.test.ts`

Expected: PASS.

### Task 3: Clarify ordinary-release prerequisite and cleanup runbook

**Files:**
- Modify: `scripts/apply-production-migrations.mjs`
- Modify: `README.md`
- Modify: `tests/integration/production-migration-policy.test.ts`

**Step 1: Write the failing test**

Assert that ordinary release errors name versions `038`–`042` and the `Production cleanup migrations` workflow rather than giving a generic unsupported-SQL error.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/production-migration-policy.test.ts`

Expected: FAIL because the error does not state the explicit prerequisite.

**Step 3: Write minimal implementation**

When the ordinary runner encounters a reviewed cleanup version, fail with the explicit prerequisite. Document creation/protection of `production-cleanup-migrations`, the exact attestation and 24-hour freshness rule, reviewed one-time versions, required backup/audit evidence, workflow sequence, recorded-version output, and prohibition on deployment actions.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/production-migration-policy.test.ts`

Expected: PASS.

### Task 4: Verify and commit

**Files:**
- Modify: `.github/workflows/production-cleanup-migrations.yml`
- Modify: `scripts/apply-production-cleanup-migrations.mjs`
- Modify: `scripts/apply-production-migrations.mjs`
- Modify: `tests/integration/cleanup-migration-workflow.test.ts`
- Modify: `tests/integration/production-cleanup-migration-policy.test.ts`
- Modify: `tests/integration/production-migration-policy.test.ts`
- Modify: `README.md`

**Step 1: Run focused tests**

Run: `npx vitest run tests/integration/cleanup-migration-workflow.test.ts tests/integration/production-cleanup-migration-policy.test.ts tests/integration/production-migration-policy.test.ts`

Expected: PASS.

**Step 2: Run repository verification**

Run: `npm test`, `npm run lint`, `npx tsc --noEmit`, and `git diff --check`.

Expected: each available command exits zero.

**Step 3: Inspect and commit**

Run: `git status --short`, `git diff --check`, `git diff`, and `git log --oneline -10`.

Commit only these files:

```bash
git add .github/workflows/production-cleanup-migrations.yml scripts/apply-production-cleanup-migrations.mjs scripts/apply-production-migrations.mjs tests/integration/cleanup-migration-workflow.test.ts tests/integration/production-cleanup-migration-policy.test.ts tests/integration/production-migration-policy.test.ts README.md docs/plans/2026-07-15-protected-cleanup-migrations.md
```
