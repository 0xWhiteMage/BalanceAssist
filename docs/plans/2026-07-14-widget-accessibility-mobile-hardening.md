# Widget Accessibility And Mobile Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the widget and every overlay a consistent accessible dialog contract and resilient mobile layout without changing controller, temporary-draft, or consent behavior.

**Architecture:** A small shared client hook owns focus entry, trapping, Escape dismissal, restoration, and inerting of sibling content. The widget, Calendly, upload policy, and attachment popover compose the hook so nested overlays isolate their immediate parent. Existing state transitions remain the sole source of overlay visibility and business status.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright.

---

### Task 1: Shared dialog behavior

**Files:**
- Create: `components/widget/use-dialog-focus.ts`
- Test: `tests/widget/use-dialog-focus.test.tsx`

1. Write tests for focus entry, Tab wrapping, Escape callback, focus restoration, and sibling inerting.
2. Run the focused test and observe failure.
3. Implement the minimal reusable hook and run the test green.

### Task 2: Compose dialog behavior in widget overlays

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/chat/calendly-embed.tsx`
- Test: `tests/widget/widget-overlay-a11y.test.tsx`
- Test: `tests/chat/calendly-embed.test.tsx`

1. Add failing tests for labelled modal contracts, nested restoration, transcript/status announcements, keyboard tabs, and controls.
2. Run the affected tests and observe failure.
3. Apply the shared hook to all overlays, preserve Calendly events as informational, and make unavailable file actions explicitly disabled.
4. Run the focused tests green.

### Task 3: Responsive geometry and browser coverage

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/chat/calendly-embed.tsx`
- Modify: `components/widget/attachment-dropzone.tsx`
- Test: `tests/e2e/mobile-intake.spec.ts`
- Test: `tests/e2e/widget.spec.ts`

1. Add failing browser coverage for focus restoration, nested dialogs, roving mobile tabs, keyboard attachment controls, and narrow layout.
2. Run the targeted browser tests and observe failure.
3. Use dynamic viewport/safe-area geometry, constrained scroll regions, 44px target sizes, and 16px mobile inputs.
4. Run focused unit, browser, type, and full relevant tests; inspect the diff and commit the requested message.
