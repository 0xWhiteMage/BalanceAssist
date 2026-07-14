# Release Proof Boundaries Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the release-proof journey so CI proves HTTP routes, all Telegram boundaries, and isolated PostgreSQL state without production transport overrides.

**Architecture:** Telegram exposes a test-scoped transport installer while production always targets Telegram's fixed API origin. A Node integration test serves the production build in-process, routes its explicitly installed test transport to a local Telegram fake, drives public HTTP routes, and checks PostgreSQL state; the handler test remains supplemental and hermetic.

**Tech Stack:** Next.js, Vitest, Node HTTP, PostgreSQL, GitHub Actions.

---

### Task 1: Make Telegram transport test-only

**Files:**
- Modify: `lib/telegram.ts`
- Modify: `tests/telegram-message.test.ts`

**Step 1:** Write failing tests proving a test-installed transport receives message/topic/document requests and `TELEGRAM_API_BASE_URL` cannot redirect production calls.

**Step 2:** Run `npx vitest run tests/telegram-message.test.ts` and confirm failure.

**Step 3:** Add a scoped transport installer used only by tests; route every Telegram operation through it and remove the environment override.

**Step 4:** Re-run the focused test and confirm success.

### Task 2: Make handler journey hermetic and complete

**Files:**
- Modify: `tests/integration/release-proof-journey.test.ts`

**Step 1:** Add failing assertions for production topic creation plus generated identity, rate-limit, replay, session, and outbox cleanup.

**Step 2:** Run the test without a database and confirm only its documented skip; run against CI PostgreSQL when available.

**Step 3:** Remove transport environment overrides, use generated identities, and clean all owned records in `afterEach`.

**Step 4:** Run focused integration verification.

### Task 3: Add production-server HTTP journey

**Files:**
- Create: `tests/integration/release-proof-http.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Step 1:** Write a TEST_DATABASE_URL-gated test that serves the production build, drives session/consent/private-upload/draft/finalize/dispatch/webhook/poll routes over HTTP, and records fake Telegram topic/message/document metadata endpoints.

**Step 2:** Run it and confirm it fails before server harness and CI wiring exist.

**Step 3:** Add a dedicated `test:release-proof:http` command and run it after migrations in the PostgreSQL CI job. Use unique port and test identity, wait for health, and always close test servers; run the supplemental handler journey in the same `test:supabase` flow.

**Step 4:** Run focused tests and the HTTP command against PostgreSQL.

### Task 4: Verify and commit

**Step 1:** Run focused tests, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run test:e2e`, and `git diff --check`.

**Step 2:** Inspect `git status --short`, `git diff`, and `git log --oneline -10`.

**Step 3:** Commit with `git commit -m "test: harden release proof transport"`.
