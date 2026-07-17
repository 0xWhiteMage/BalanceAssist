# Bounded Commitment Sanitizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evaluate direct pricing at clause scope and recognize curly-apostrophe `we'll have ... ready` commitments while preserving inline attribution and benign non-commitments.

**Architecture:** Normalize apostrophes, then split replies into bounded clauses at sentence boundaries, contrast words, and semicolons. Evaluate direct pricing and attribution within each clause using a shared currency expression, and extend the ready-commitment subject to include `we'll`.

**Tech Stack:** TypeScript, Vitest, ESLint

---

### Task 1: Apply clause-level commitment semantics

**Files:**
- Modify: `tests/conversation/reply-sanitize.test.ts`
- Modify: `lib/conversation/reply-sanitize.ts`

**Step 1: Write the failing tests**

Add the approved exact matrix for `We’ll have it ready by Friday`, direct pricing with `will be`, `comes to`, `totals`, and `equals`, plus attribution followed by a contrasting commitment clause. Retain existing inline and same-clause attribution controls and benign non-commitments.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/conversation/reply-sanitize.test.ts`

Expected: the new curly-apostrophe, pricing-verb, and attribution-separated commitment cases fail because they are not overridden; existing precision cases pass.

**Step 3: Write the minimal implementation**

Split normalized replies at sentence boundaries, `but`, `however`, and semicolons. Evaluate the expanded `price|fee|cost` commitment grammar and attribution allowlist per clause. Extend the concrete ready pattern from `we can|will` to `we'll|we can|we will`.

**Step 4: Run focused tests to verify GREEN**

Run: `npx vitest run tests/conversation/reply-sanitize.test.ts`

Expected: all sanitizer tests pass.

**Step 5: Run affected verification**

Run: `npx vitest run tests/conversation tests/api`

Run: `npx tsc --noEmit`

Run: `npm run lint`

Run: `git diff --check`

Expected: all commands exit successfully; diff check may report only repository line-ending notices.

**Step 6: Commit**

Stage the implementation plan, sanitizer, and sanitizer tests, then commit with `fix: close final commitment sanitizer gaps`.
