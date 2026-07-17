# Bounded Commitment Sanitizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect every structurally direct numeric or spelled-out pricing assertion while exempting only attribution attached to that same subject.

**Architecture:** Match each `price|fee|cost` subject immediately followed by an assertion verb and money amount across the normalized reply. Inspect only the text immediately preceding each matched subject for attached attribution, removing clause splitting and connector enumeration.

**Tech Stack:** TypeScript, Vitest, ESLint

---

### Task 1: Apply subject-local pricing attribution

**Files:**
- Modify: `tests/conversation/reply-sanitize.test.ts`
- Modify: `lib/conversation/reply-sanitize.ts`

**Step 1: Write the failing tests**

Add the review's five exact direct-assertion cases, including conjunction variants and spelled-out money. Retain subject-local controls such as `you stated the fee`, `your stated fee`, and `client-provided fee`, structurally interrupted attribution, and benign non-money language.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/conversation/reply-sanitize.test.ts`

Expected: the three conjunction cases fail because broad attribution suppresses them, and the two spelled-out direct assertions fail because the direct matcher accepts only numeric amounts.

**Step 3: Write the minimal implementation**

Create a numeric-or-spelled money expression and find each direct pricing assertion in the full normalized reply. For each match, inspect only its immediate prefix for attribution attached to the matched subject. Remove separator splitting and broad attribution suppression.

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
