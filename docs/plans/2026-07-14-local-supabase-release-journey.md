# Local Supabase Release Journey Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make CI prove the critical release journey through a local Supabase/PostgREST stack and a spawned production Next server.

**Architecture:** Supabase CLI owns a disposable Docker stack; the repository's existing ordered migration runner applies the incremental chain to its local PostgreSQL database without applying legacy `000_full_schema.sql`. A local-only wrapper obtains CLI-generated credentials without logging them and scopes them to a real HTTP integration test that starts a fake Telegram server and `next start`. The test drives public routes and validates persisted state over Supabase HTTP; it generates unique data and removes all owned records.

**Tech Stack:** Supabase CLI, Docker, PostgREST, Next.js, Vitest, Node HTTP/child processes, GitHub Actions.

---

### Task 1: Add local Supabase configuration and prerequisite-aware runner

**Files:**
- Create: `supabase/config.toml`
- Create: `scripts/test-supabase.mjs`
- Modify: `package.json`
- Test: `tests/integration/supabase-local-runner.test.ts`

**Step 1:** Write a failing runner-source test for a non-failing Docker/CLI prerequisite message and credential-scoped test command.

**Step 2:** Run `npx vitest run tests/integration/supabase-local-runner.test.ts` and confirm failure.

**Step 3:** Add the minimal local stack config and runner. The runner must apply the ordered incremental migrations to the Supabase database, capture `supabase status -o env` without printing credentials, and execute the HTTP suite with only those process variables.

**Step 4:** Re-run the focused test and confirm success.

### Task 2: Make Telegram substitution explicitly test-only

**Files:**
- Modify: `lib/telegram.ts`
- Modify: `tests/telegram-message.test.ts`
- Modify: `tests/integration/release-proof-journey.test.ts`

**Step 1:** Run the existing Telegram boundary test and capture its pre-change result.

**Step 2:** Replace the environment-selected production origin with an explicitly installed test transport that only accepts a loopback origin.

**Step 3:** Re-run `npx vitest run tests/telegram-message.test.ts` and confirm all paths use the fake transport only when installed.

### Task 3: Add real HTTP release journey

**Files:**
- Create: `tests/integration/release-proof-http.test.ts`
- Modify: `package.json`
- Test: `tests/integration/release-proof-http.test.ts`

**Step 1:** Write the HTTP journey test so it requires Supabase local credentials, starts a fake Telegram HTTP endpoint and `next start`, and asserts the session, consent, draft, finalization/outbox, topic/message, webhook, and polling journey.

**Step 2:** Run the focused test before its harness is complete and confirm the expected failure or documented prerequisite skip.

**Step 3:** Implement process readiness, test-only Telegram transport setup, Supabase HTTP state checks, unique identities, and `afterEach` cleanup.

**Step 4:** Re-run the focused test against the local stack if Docker and CLI are available.

### Task 4: Wire CI diagnostics and document optional local usage

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Test: `tests/integration/supabase-local-runner.test.ts`

**Step 1:** Write the workflow/source assertions for CLI installation, stack teardown, and failure diagnostics.

**Step 2:** Run the focused runner test and confirm failure.

**Step 3:** Replace the plain PostgreSQL database job with the local Supabase CLI workflow, add an always-run stop/log diagnostic step, and document `npm run test:supabase` as optional local verification.

**Step 4:** Run static checks, focused tests, TypeScript, and `git diff --check`; run the local stack only when prerequisites are available.

### Task 5: Commit verified changes

**Files:**
- Modify: intended files from Tasks 1-4

**Step 1:** Inspect `git status --short`, `git diff --check`, and `git diff`.

**Step 2:** Commit the intended release-hardening changes with `test: run release journey against Supabase stack`.
