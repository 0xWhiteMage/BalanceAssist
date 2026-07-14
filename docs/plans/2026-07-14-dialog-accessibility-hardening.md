# Dialog Accessibility Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close dialog focus, inert-background, transcript announcement, private-upload keyboard, and narrow mobile layout accessibility gaps.

**Architecture:** Keep dialog focus and inert ownership in the existing `useDialogFocus` hook. The outer widget establishes an inert page background; nested dialogs inert their parent dialog controls while preserving the nested dialog. The transcript is the single live announcement region, with status messages retained only for non-transcript state.

**Tech Stack:** Next.js, React, TypeScript, Vitest with Testing Library, Playwright.

---

### Task 1: Focusable dialog controls and inert stack

**Files:**
- Modify: `components/widget/use-dialog-focus.ts`
- Test: `tests/widget/use-dialog-focus.test.tsx`

**Step 1:** Add failing tests covering hidden, inert, and `tabIndex={-1}` dialog descendants, plus nested dialog inerting and restoration.

**Step 2:** Run `npx vitest run tests/widget/use-dialog-focus.test.tsx` and confirm the new expectations fail.

**Step 3:** Filter candidates by disabled, inert ancestor, negative tab index, hidden ancestor, and layout visibility; track inert attributes by element so nested dialogs restore only attributes they introduced.

**Step 4:** Run the focused Vitest test and confirm it passes.

### Task 2: Single transcript live announcer

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Test: `tests/widget/widget-overlay-a11y.test.tsx`

**Step 1:** Add a failing assertion that transcript updates have exactly one polite live-region owner.

**Step 2:** Run `npx vitest run tests/widget/widget-overlay-a11y.test.tsx` and confirm failure.

**Step 3:** Make `role="log"` the transcript announcer and remove live-region attributes from its containing chat panel.

**Step 4:** Run the focused Vitest test and confirm it passes.

### Task 3: Private upload keyboard and narrow mobile E2E

**Files:**
- Modify: `tests/e2e/widget.spec.ts`
- Modify: `tests/e2e/mobile-intake.spec.ts`

**Step 1:** Add Playwright tests that open the private-reference dialog by keyboard, select an available private file via the chooser, and verify narrow viewport scroll width, action size, and overlay bounds.

**Step 2:** Run the focused Playwright specs and confirm failures where coverage detects the gaps.

**Step 3:** Apply the smallest layout/accessibility adjustments required by the test results.

**Step 4:** Run focused Playwright specs and confirm they pass.

### Task 4: Full verification and commit

**Files:**
- Verify all modified files

**Step 1:** Run focused and full relevant Vitest, Playwright, TypeScript, and diff checks.

**Step 2:** Commit only the accessibility hardening files with `fix: close dialog accessibility gaps`.
