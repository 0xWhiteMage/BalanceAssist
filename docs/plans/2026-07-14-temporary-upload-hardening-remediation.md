# Temporary Upload Hardening Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep analysis-only attachments out of producer handoff paths while bounding analysis work and proving current private-storage safety.

**Architecture:** Producer packet queries exclude opaque private-upload rows. The widget passes only server analysis text to the LLM. Extraction enforces stream, output, and aggregate budgets. A database attestation evaluates effective browser-role access rather than direct catalog rows alone.

**Tech Stack:** TypeScript, Next.js, React, Vitest, PostgreSQL/Supabase migrations.

---

### Task 1: Producer And Widget Isolation

**Files:**
- Modify: `tests/api/leads-finalize.test.ts`, `tests/widget/widget-overlay.test.ts`
- Modify: `app/api/leads/finalize/route.ts`, `components/widget/widget-overlay.tsx`

1. Write failing packet exclusion and filename-free LLM prompt tests.
2. Run their focused tests and observe failures.
3. Add minimal query and callback changes.
4. Re-run focused tests.

### Task 2: Bounded Extraction

**Files:**
- Modify: `tests/uploads/extract-text.test.ts`
- Modify: `lib/uploads/extract-text.ts`

1. Write a compressed PDF bomb regression test.
2. Run the extractor test and observe failure.
3. Add compressed-size, output, and aggregate inflation limits.
4. Re-run the extractor test.

### Task 3: Effective Attestation And Route Recovery

**Files:**
- Modify: `tests/uploads/private-storage.test.ts`, `tests/api/private-upload-route.test.ts`, `tests/integration/database-schema.test.ts`
- Create: `supabase/migrations/034_private_attachment_effective_attestation.sql`

1. Write failing readiness and failed-compensation tests plus source/DB assertions.
2. Run focused tests and observe failures.
3. Add fail-closed effective-role attestation and recovery behavior.
4. Re-run focused tests.

### Task 4: Verify And Commit

1. Run focused suites, `npm test`, `npx tsc --noEmit`, and `git diff --check`.
2. Commit `fix: harden temporary attachment analysis`.
