# Task 4 Quality Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prove and enforce equal, operable, high-contrast widget entry actions on desktop and device-emulated mobile Chromium.

**Architecture:** Keep the existing `DataUseNotice` structure and shared action treatment. Strengthen its required callback contract and use the existing opaque warm-gold token for both persistent boundaries and focus; verify contrast locally in tests. Add one Pixel 5 Playwright project scoped to `widget.spec.ts` while preserving the desktop project and existing mobile intake project.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, Playwright Chromium, CSS.

**Cross-browser decision:** `npm run test:e2e` installs Chromium only, and the existing project matrix contains no Firefox or WebKit project. Pixel 5 Chromium emulation adds the required mobile proof without introducing unprovisioned browser dependencies or duplicating unrelated suites across new engines.

---

### Task 1: Enforce Required Actions And Boundary Contrast

**Files:**
- Modify: `tests/widget/data-use-notice.test.tsx`
- Modify: `components/widget/data-use-notice.tsx`

1. Replace whole-`cssText` equality with meaningful shared class, size, border, background, weight, and padding checks.
2. Add a local WCAG contrast calculation proving the boundary is at least 3:1 against `#101010` and `#1d1d1d`.
3. Run the focused unit test and verify RED against the translucent border token.
4. Make `onHuman` and `onLeave` required and use `brandTokens.colors.warmGold` for the shared boundary.
5. Update every legitimate test fixture with explicit callbacks and run focused unit/a11y tests to verify GREEN.

### Task 2: Strengthen Browser Proof And Mobile Emulation

**Files:**
- Modify: `tests/e2e/widget.spec.ts`
- Modify: `playwright.config.ts`

1. Require a computed focus width of at least 2px, a nontransparent expected warm-gold color, and at least 3:1 contrast against both panel gradient endpoints.
2. Mock successful session creation and consent persistence, then assert a stable AI-mode outcome after keyboard activation.
3. Verify the new mobile project name is initially unavailable.
4. Add `mobile-widget-chromium` with Pixel 5 emulation and `widget.spec.ts` scope; preserve desktop and existing mobile intake projects.
5. Run the focused test under `desktop-chromium` and `mobile-widget-chromium`.
6. Run focused unit tests, TypeScript, lint, and diff checks; review scope and commit once.
