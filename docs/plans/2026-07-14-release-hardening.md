# Release Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gate production deployment, migration, Telegram setup, and scheduler operations behind explicit, testable release contracts.

**Architecture:** GitHub Actions owns the protected release sequence and Vercel only hosts immutable deployments plus explicit alias promotion. Internal authenticated routes persist scheduler worker heartbeats and report operational backlogs. Static Vitest assertions parse the workflow YAML to prevent contract drift.

**Tech Stack:** GitHub Actions YAML, Vercel CLI, Next.js route handlers, Supabase, Vitest, TypeScript, `yaml`.

---

### Task 1: Define failing release workflow contracts

**Files:**
- Create: `tests/integration/release-workflow.test.ts`
- Create: `.github/workflows/production-release.yml`
- Create: `.github/workflows/production-migration.yml`

**Step 1:** Add YAML parsing assertions for manual-only, protected, ordered release and migration workflows.

**Step 2:** Run `npx vitest run tests/integration/release-workflow.test.ts` and confirm failure because workflows are absent.

**Step 3:** Add minimal workflows that rerun gates, deploy an immutable URL, smoke it, require recorded migration, promote, then configure Telegram.

**Step 4:** Rerun the focused test and confirm success.

### Task 2: Define failing scheduler health contracts

**Files:**
- Create: `tests/api/scheduler-health.test.ts`
- Modify: `app/api/internal/*`
- Modify: `.github/workflows/handoff-dispatch.yml`
- Modify: `.github/workflows/session-expiry.yml`
- Create: `.github/workflows/scheduler-health.yml`

**Step 1:** Add a failing route test for authorization and stale heartbeat/backlog failure.

**Step 2:** Run the focused test and confirm it fails because routes are absent.

**Step 3:** Add protected heartbeat and health routes, persist minimal state through existing Supabase access, and call them from schedules.

**Step 4:** Rerun the focused test and confirm success.

### Task 3: Extend static workflow coverage and runbook

**Files:**
- Modify: `tests/integration/handoff-dispatch-workflow.test.ts`
- Modify: `README.md`

**Step 1:** Add failing assertions that worker configuration is fail-closed and health-monitored.

**Step 2:** Run focused workflow tests and confirm failure.

**Step 3:** Document Vercel Git deployment disablement, protected environment secrets, production migration approval, release order, and scheduler response.

**Step 4:** Run focused workflow tests and confirm success.

### Task 4: Verify and commit

**Files:** all changed files

**Step 1:** Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `git diff --check`.

**Step 2:** Inspect `git status --short` and `git diff --check`.

**Step 3:** Commit with `ci: gate production deployment and scheduler health`.
