# Release Proof Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prove a critical persisted-session-to-Telegram-reply journey in CI using real route handlers and disposable PostgreSQL.

**Architecture:** This historical plan is superseded for Telegram transport by `2026-07-14-release-proof-boundaries.md`: release proof now uses an explicit test-installed transport while production always uses Telegram's fixed API origin. Playwright retains its production build/start command and gains failure artifacts.

**Tech Stack:** Next.js route handlers, Vitest, `pg`, PostgreSQL 16, Playwright, GitHub Actions.

---

### Task 1: Make the Telegram endpoint replaceable at the HTTP boundary

**Files:**
- Modify: `lib/telegram.ts:32-96`
- Test: `tests/telegram-message.test.ts`

**Step 1: Write the failing test**

Superseded: prove an explicit test-installed transport receives Telegram requests while deployment environment values cannot redirect the fixed Telegram API origin.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram-message.test.ts`
Expected: FAIL because the request still targets `https://api.telegram.org`.

**Step 3: Write minimal implementation**

Superseded: retain Telegram's fixed production API origin and route test calls only through the scoped test transport installer.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram-message.test.ts`
Expected: PASS.

### Task 2: Add a real-route critical journey

**Files:**
- Create: `tests/integration/release-proof-journey.test.ts`
- Modify: `package.json:12-16`

**Step 1: Write the failing test**

Create a node-environment, `describe.skipIf(!TEST_DATABASE_URL)` test that starts a local HTTP Telegram fake, installs a PostgreSQL-backed Supabase adapter, and calls the real session, consent, draft, finalize, dispatch, webhook, and polling handlers. Assert persisted capability, consent ledger state, canonical draft version, queued then sent outbox state, authenticated fake Telegram payload, signed webhook persistence, and polled reply.

**Step 2: Run test to verify it fails**

Run: `npx vitest run --no-file-parallelism tests/integration/release-proof-journey.test.ts`
Expected: FAIL before the adapter and journey are complete; with no database URL it reports one skipped suite.

**Step 3: Write minimal test support and command wiring**

Implement only the Supabase query-builder methods used by the exercised production routes, each backed by parameterized `pg` queries. Add the journey test to `test:db`; retain its existing migrations-before-tests CI order.

**Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=<disposable-url> npm run test:db:prepare` then `TEST_DATABASE_URL=<disposable-url> npx vitest run --no-file-parallelism tests/integration/release-proof-journey.test.ts`
Expected: migration execution and journey PASS.

### Task 3: Harden Playwright CI diagnostics

**Files:**
- Modify: `playwright.config.ts:3-29`
- Modify: `tests/e2e/intake.spec.ts:216-223`
- Modify: `.github/workflows/ci.yml:121-132`
- Test: `tests/integration/migration-runner.test.ts`

**Step 1: Write the failing test**

Add configuration assertions for CI retries, failure trace/screenshots, HTML/JUnit reports, and CI artifact upload. Update the intake test to exercise the visible approval button without forced clicking.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/migration-runner.test.ts`
Expected: FAIL because diagnostic configuration and artifact upload are absent.

**Step 3: Write minimal implementation**

Configure retry-on-CI, retain-on-failure traces, failure-only screenshots, reports, and a non-optional artifact upload step. Preserve `npm run build && npm run start`; replace the forced click with normal Playwright actionability.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/migration-runner.test.ts tests/e2e/intake.spec.ts`
Expected: Vitest PASS; Playwright spec is checked through `npm run test:e2e` in CI/local supported environment.

### Task 4: Make lint evidence reliable and document release proof

**Files:**
- Modify: `package.json:5-17`
- Modify: `.github/workflows/ci.yml:10-20`
- Modify: `README.md:5-13,136-151`
- Modify: `.env.example:18-24`
- Test: `tests/integration/migration-runner.test.ts`

**Step 1: Write the failing test**

Add assertions for the release-proof database command and CI database invocation; reproduce lint in the workspace to determine whether an isolated command is necessary.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/migration-runner.test.ts`
Expected: FAIL before command and workflow assertions match.

**Step 3: Write minimal implementation**

Use the normal lint command if it resolves cleanly; otherwise add an equally strict isolated command/workdir. Document disposable `TEST_DATABASE_URL`, fake Telegram configuration, migration execution, integration journey, and Playwright artifact evidence.

**Step 4: Run focused and full verification**

Run: focused Vitest tests, `npm run test:db` with disposable PostgreSQL, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `git diff --check`, and `git diff`.
Expected: all available checks PASS; report any unavailable Docker/PostgreSQL or browser prerequisites as blockers.

### Task 5: Commit release proof

**Files:**
- Stage only the release-proof test, Telegram seam, CI, Playwright, scripts, and documentation changes.

**Step 1: Inspect final changes**

Run: `git status --short`, `git diff --check`, `git diff`, and `git log --oneline -10`.

**Step 2: Commit**

Run: `git commit -m "test: prove critical release journey"`
