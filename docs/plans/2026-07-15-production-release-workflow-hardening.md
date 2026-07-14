# Production Release Workflow Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure production releases run only from the trusted main workflow definition, cannot bypass reviewed cleanup migrations, and use immutable action and Vercel CLI dependencies.

**Architecture:** The validation job verifies the workflow definition ref before protected jobs can access environments. The production migration runner queries the migration tracker before evaluating expand-only migrations, allowing reviewed cleanup versions only when every one is already recorded. Workflow static tests enforce immutable third-party dependencies and local Vercel CLI use.

**Tech Stack:** GitHub Actions YAML, Node.js ESM, PostgreSQL via `pg`, Vitest, npm lockfile.

---

### Task 1: Add failing release workflow policy tests

**Files:**
- Modify: `tests/integration/release-workflow.test.ts`

**Step 1:** Require the trusted-main workflow-ref assertion, SHA-pinned action references, and local Vercel commands.

**Step 2:** Run `npx vitest run tests/integration/release-workflow.test.ts` and confirm it fails.

**Step 3:** Update `.github/workflows/production-release.yml` and the locked dependency metadata.

**Step 4:** Re-run the focused workflow test and confirm it passes.

### Task 2: Add failing migration tracker policy tests

**Files:**
- Modify: `tests/integration/production-migration-policy.test.ts`

**Step 1:** Require preflight acceptance only when all reviewed cleanup versions are recorded, and rejection when any are missing.

**Step 2:** Run `npx vitest run tests/integration/production-migration-policy.test.ts` and confirm it fails.

**Step 3:** Query `public.schema_migrations` before production migration validation and fail closed for incomplete cleanup migration history.

**Step 4:** Re-run the focused migration test and confirm it passes.

### Task 3: Document and verify the policy

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1:** Describe the trusted workflow-ref guard, recorded-cleanup prerequisite, and locked local Vercel CLI.

**Step 2:** Run focused tests, `npm test`, `npm run lint`, `npx tsc --noEmit`, and `git diff --check`.

**Step 3:** Inspect the intended diff and commit it as `fix: harden production release workflow`.
