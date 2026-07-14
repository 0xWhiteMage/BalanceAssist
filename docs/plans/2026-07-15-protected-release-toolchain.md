# Protected Release Toolchain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair the protected production release toolchain without weakening release trust boundaries.

**Architecture:** Pin the local Vercel CLI to the audit-safe release and make promotion independently install that exact dependency after a validated-SHA checkout. Parsed YAML tests provide regression coverage for the release invariants.

**Tech Stack:** npm lockfile, GitHub Actions YAML, Vitest, yaml parser.

---

### Task 1: Specify Promote Prerequisites

**Files:**
- Modify: `tests/integration/release-workflow.test.ts`
- Modify: `.github/workflows/production-release.yml`

**Step 1:** Add assertions requiring the validated checkout, immutable setup-node action, `npm ci`, and local Vercel alias command in `promote`.

**Step 2:** Run `npm test -- --run tests/integration/release-workflow.test.ts` and confirm the new assertions fail because promotion lacks prerequisites.

**Step 3:** Add those prerequisite steps to `promote` without changing its credential or reference inputs.

**Step 4:** Re-run the targeted test and confirm it passes.

### Task 2: Pin the Audit-Safe CLI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/integration/release-workflow.test.ts`

**Step 1:** Change the expected exact CLI version to `54.17.3` and run the targeted test to confirm it fails.

**Step 2:** Generate only the matching lockfile update with `npm install --package-lock-only --save-dev --save-exact vercel@54.17.3`.

**Step 3:** Re-run the targeted test and `npm audit --audit-level=high`.

### Task 3: Verify and Commit

**Files:**
- Verify changed files only

**Step 1:** Run full tests, lint, TypeScript, parallel E2E, and `git diff --check`.

**Step 2:** Inspect status and diff, then commit the intended files as `fix: repair protected release toolchain`.
