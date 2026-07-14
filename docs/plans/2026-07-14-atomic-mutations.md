# Atomic Mutations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make lead finalization, canonical draft updates, and human relays atomic, idempotent database mutations.

**Architecture:** A forward migration adds service-role-only RPCs which lock the session and calculate authoritative outcomes from persisted data. Routes authenticate the session capability then delegate the mutation to an RPC; the browser receives only canonical results.

**Tech Stack:** Next.js route handlers, TypeScript, PostgreSQL/Supabase RPCs, Vitest, pg.

---

### Task 1: Database mutation tests

**Files:**
- Modify: `tests/integration/database-schema.test.ts`

**Step 1:** Add database-gated concurrency and retry tests for finalization, draft CAS, and relay persistence/outbox identity.

**Step 2:** Run `npm run test:db -- --runInBand` and verify the new tests fail because the RPCs do not exist.

### Task 2: Atomic RPC migration

**Files:**
- Create: `supabase/migrations/036_atomic_mutations.sql`

**Step 1:** Implement locked, idempotent finalization, compare-and-swap canonical draft updates, and message-idempotent relay insertion/outbox enqueue.

**Step 2:** Run the database tests and verify they pass.

### Task 3: Route adapters

**Files:**
- Modify: `app/api/leads/finalize/route.ts`
- Modify: `app/api/projects/[sessionId]/draft/route.ts`
- Modify: `app/api/telegram/relay/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `lib/api/client.ts`
- Test: `tests/api/leads-finalize.test.ts`
- Test: `tests/api/telegram-relay-events.test.ts`

**Step 1:** Add failing route tests for RPC result handling and stale conflicts.

**Step 2:** Replace composed writes with RPC calls, preserving capability checks and only minimal client contract changes.

**Step 3:** Run focused route tests and TypeScript checks.

### Task 4: Verification and commit

**Step 1:** Run focused tests, database tests, full relevant tests, `tsc --noEmit`, and inspect the diff.

**Step 2:** Commit the intended files as `fix: make lead draft and relay mutations atomic`.
