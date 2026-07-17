# Bounded Commitment Sanitizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Override direct unqualified currency pricing and concrete `we can/will have ... ready` commitments while preserving explicit user attribution and benign non-commitments.

**Architecture:** Split replies into bounded sentence fragments for direct pricing classification, and exempt only fragments containing an explicit attribution marker. Extend the existing producer timing patterns with a narrowly structured ready-commitment expression that requires a concrete date or duration.

**Tech Stack:** TypeScript, Vitest, ESLint

---

### Task 1: Close pricing and ready-commitment gaps

**Files:**
- Modify: `tests/conversation/reply-sanitize.test.ts`
- Modify: `lib/conversation/reply-sanitize.ts`

**Step 1: Write the failing tests**

Add table-driven tests proving that `The price is SGD 12,000`, `The fee is $5,000`, `The cost is EUR 4,000`, and concrete `we can/will have ... ready` statements override and discard draft updates. Add pass-through cases for same-sentence `you entered`, `you stated`, `your budget`, and `client-provided` attribution, plus `The price is expressed in dollars` and `We can have it ready for discussion`.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/conversation/reply-sanitize.test.ts`

Expected: the new unqualified pricing and ready-commitment cases fail because they are not overridden; existing and new precision cases pass.

**Step 3: Write the minimal implementation**

Add a sentence-level direct pricing check using bounded sentence splitting, a direct `price|fee|cost is <currency amount>` pattern, and an attribution allowlist limited to the same sentence. Add one producer-boundary regex for `we can/will have it|the film|the video|the project ready` followed by `by <date>` or `in|within <duration>`.

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
