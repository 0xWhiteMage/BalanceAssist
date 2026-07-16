# Monday Verifier Schema Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the Monday canary schema verifier compatible with API version 2026-07 after removal of board capability support.

**Architecture:** The verifier remains a standalone Node script. A focused static test locks its GraphQL selection set to identity, columns, status labels, and validation fingerprint fields while excluding the retired board capability argument, field, and item-name assertion.

**Tech Stack:** Node.js, Vitest, GraphQL string query.

---

### Task 1: Lock the compatible schema-verifier query with a failing regression test

**Files:**
- Create: `tests/monday/schema-verifier.test.ts`
- Test: `tests/monday/schema-verifier.test.ts`

**Step 1: Write the failing test**

Read `scripts/verify-monday-schema.mjs` and assert that it retains the account, board kind, workspace, columns, and validations selections; does not contain `capabilities`; and does not include the item-name capability error condition.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/monday/schema-verifier.test.ts`

Expected: FAIL because the verifier still contains retired capability references.

### Task 2: Remove retired Monday capability references

**Files:**
- Modify: `scripts/verify-monday-schema.mjs:13,18`
- Test: `tests/monday/schema-verifier.test.ts`

**Step 1: Write minimal implementation**

Remove `capabilities: []` from `boards`, remove the `capabilities` board selection, and remove only the `board?.capabilities?.item_name !== true` condition. Leave all other contract checks unchanged.

**Step 2: Run test to verify it passes**

Run: `npx vitest run tests/monday/schema-verifier.test.ts`

Expected: PASS.

**Step 3: Run focused related tests**

Run: `npx vitest run tests/monday/schema-verifier.test.ts tests/monday/schema-provisioning.test.ts tests/integration/monday-release-proof.test.ts`

Expected: PASS.

**Step 4: Commit**

Run:
```bash
git add docs/plans/2026-07-16-monday-verifier-schema-compatibility.md tests/monday/schema-verifier.test.ts scripts/verify-monday-schema.mjs
```
