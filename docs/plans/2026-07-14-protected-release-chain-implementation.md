# Protected Release Chain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fail closed across the protected production release chain, migrations, readiness checks, and Vercel audit attestation.

**Architecture:** The release workflow remains the single orchestrator. Parsed workflow contract tests enforce its DAG, credential gating, validated-SHA propagation, bounded readiness probes, and smoke sequence. A restricted SQL parser permits only the additive statement forms present in current forward migrations after the policy baseline.

**Tech Stack:** GitHub Actions YAML, Node.js ESM, Vitest, YAML parser, PostgreSQL SQL.

---

### Task 1: Protect Workflow Contracts

**Files:**
- Modify: `.github/workflows/production-release.yml`
- Test: `tests/integration/release-workflow.test.ts`

1. Write contract expectations for direct `validate` dependencies, validated SHA availability, credentialed job topology, attestation format/freshness, readiness, and immutable/alias smoke ordering.
2. Run `npx vitest run tests/integration/release-workflow.test.ts` and confirm the expectations fail.
3. Add the minimum workflow dependencies and bounded secret-safe checks.
4. Re-run the focused test and confirm it passes.

### Task 2: Fail Closed Migration SQL

**Files:**
- Modify: `scripts/apply-production-migrations.mjs`
- Test: `tests/integration/production-migration-policy.test.ts`

1. Write failing tests for allowed additive statements and comments, multi-statement payloads, destructive statements, DML, procedural SQL, and comment-obfuscated bypasses.
2. Run `npx vitest run tests/integration/production-migration-policy.test.ts` and confirm failure.
3. Replace the denylist with a restricted parser that accepts only the needed additive grammar.
4. Re-run the focused test and confirm it passes.

### Task 3: Verify And Commit

**Files:**
- Modify: `README.md`
- Modify: release files and tests above

1. Update the operator documentation for the 90-day attestation and protected checks.
2. Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `git diff --check`.
3. Inspect status and diff, then commit intended files with `fix: enforce protected release chain`.
