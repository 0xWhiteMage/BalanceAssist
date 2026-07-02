# Balance Assist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first working Balance Assist proof-of-concept as a hosted Next.js widget with a premium branded UI, deterministic onboarding flow, real session persistence, and placeholders for live integrations.

**Architecture:** Use a single Next.js App Router application for the widget UI and backend routes. Keep the product workflow-first by storing lead progress in structured state and using deterministic rules for onboarding, qualification, guidance, and handoff. Restrict LLM usage to optional summary/compression paths behind a server-side orchestration layer.

**Tech Stack:** Next.js, TypeScript, React, Tailwind CSS, Vitest, React Testing Library, Playwright, Zod, Supabase client libraries

---

### Task 1: Scaffold the application shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.js`
- Create: `tailwind.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx`
- Create: `app/widget/page.tsx`
- Create: `public/`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `playwright.config.ts`
- Create: `tests/smoke/app-shell.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';

test('renders Balance Assist home shell', () => {
  render(<HomePage />);
  expect(screen.getByText(/Balance Assist/i)).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- app-shell`
Expected: FAIL because the app files and test setup do not exist yet.

**Step 3: Write minimal implementation**

- Create the Next.js project files manually
- Add scripts for `dev`, `build`, `lint`, `test`, and `test:e2e`
- Add a minimal page that renders `Balance Assist`

**Step 4: Run test to verify it passes**

Run: `npm run test -- app-shell`
Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "feat: scaffold balance assist app shell"
```

### Task 2: Build the brand system and widget frame

**Files:**
- Create: `lib/brand-tokens.ts`
- Create: `components/widget/widget-shell.tsx`
- Create: `components/widget/widget-header.tsx`
- Create: `components/widget/widget-footer.tsx`
- Create: `components/widget/launcher-preview.tsx`
- Create: `components/ui/button.tsx`
- Create: `components/ui/card.tsx`
- Create: `components/ui/chip.tsx`
- Create: `tests/widget/widget-shell.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { WidgetShell } from '@/components/widget/widget-shell';

test('renders Balance Assist with human escalation visible', () => {
  render(<WidgetShell><div>Body</div></WidgetShell>);
  expect(screen.getByText(/Balance Assist/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Talk to a human/i })).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- widget-shell`
Expected: FAIL because the shell component does not exist.

**Step 3: Write minimal implementation**

- Add reusable layout shell using the approved brand palette
- Keep footer human CTA visible
- Add foundational button, card, and chip components

**Step 4: Run test to verify it passes**

Run: `npm run test -- widget-shell`
Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add branded widget shell"
```

### Task 3: Implement deterministic onboarding configuration and state

**Files:**
- Create: `lib/onboarding/service-options.ts`
- Create: `lib/onboarding/flow-config.ts`
- Create: `lib/onboarding/types.ts`
- Create: `lib/onboarding/default-state.ts`
- Create: `lib/onboarding/progress.ts`
- Create: `components/onboarding/welcome-actions.tsx`
- Create: `components/onboarding/essentials-step.tsx`
- Create: `tests/onboarding/progress.test.ts`
- Create: `tests/onboarding/essentials-step.test.tsx`

**Step 1: Write the failing test**

```ts
import { getEssentialsProgress } from '@/lib/onboarding/progress';

test('counts completed essential fields', () => {
  expect(getEssentialsProgress({
    service: 'production',
    projectScope: 'Brand campaign',
    timelineBand: '1-2-months',
    budgetBand: '50k-150k',
    contactName: ''
  })).toEqual({ completed: 4, total: 5 });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- onboarding/progress`
Expected: FAIL because the onboarding modules do not exist.

**Step 3: Write minimal implementation**

- Add deterministic service categories and essentials state
- Add a simple progress helper
- Build the welcome action cards and essentials step UI

**Step 4: Run test to verify it passes**

Run: `npm run test -- onboarding`
Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add deterministic onboarding flow"
```

### Task 4: Add qualification and guidance rules

**Files:**
- Create: `lib/qualification/score.ts`
- Create: `lib/qualification/budget-matrix.ts`
- Create: `lib/qualification/timeline-matrix.ts`
- Create: `lib/qualification/next-step.ts`
- Create: `components/onboarding/summary-panel.tsx`
- Create: `tests/qualification/score.test.ts`
- Create: `tests/qualification/guidance.test.ts`

**Step 1: Write the failing test**

```ts
import { scoreLead } from '@/lib/qualification/score';

test('marks a relevant complete inquiry as qualified', () => {
  const result = scoreLead({
    service: 'production',
    budgetBand: '50k-150k',
    timelineBand: '1-2-months',
    projectScope: 'Regional brand launch film',
    contactName: 'Jane Lee',
    contactEmail: 'jane@example.com'
  });

  expect(result.status).toBe('qualified');
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- qualification/score`
Expected: FAIL because the scoring logic does not exist.

**Step 3: Write minimal implementation**

- Create deterministic lead scoring
- Create rule-based budget and timeline guidance text
- Render a summary panel with disclaimer and recommended next step

**Step 4: Run test to verify it passes**

Run: `npm run test -- qualification`
Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add qualification and guidance rules"
```

### Task 5: Add uploads and file review state

**Files:**
- Create: `lib/uploads/types.ts`
- Create: `lib/uploads/status.ts`
- Create: `components/uploads/upload-dropzone.tsx`
- Create: `components/uploads/upload-list.tsx`
- Create: `components/uploads/file-review-cards.tsx`
- Create: `tests/uploads/upload-status.test.ts`
- Create: `tests/uploads/upload-list.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { UploadList } from '@/components/uploads/upload-list';

test('shows upload statuses including needs human review', () => {
  render(<UploadList uploads={[{ id: '1', name: 'brief.pdf', status: 'needs_human_review' }]} />);
  expect(screen.getByText(/Needs human review/i)).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- uploads`
Expected: FAIL because upload components do not exist.

**Step 3: Write minimal implementation**

- Add client-side upload UI states only first
- Include `From your file` and `My inference` review cards
- Keep the scope limited to visual and local state behavior for MVP scaffold

**Step 4: Run test to verify it passes**

Run: `npm run test -- uploads`
Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add upload review states"
```

### Task 6: Add session schema, API contracts, and Supabase adapters

**Files:**
- Create: `lib/env.ts`
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/db/schema.ts`
- Create: `lib/api/contracts.ts`
- Create: `app/api/sessions/route.ts`
- Create: `app/api/events/route.ts`
- Create: `app/api/leads/finalize/route.ts`
- Create: `tests/api/contracts.test.ts`
- Create: `tests/api/sessions-route.test.ts`

**Step 1: Write the failing test**

```ts
import { createSessionPayloadSchema } from '@/lib/api/contracts';

test('validates a session create payload', () => {
  const result = createSessionPayloadSchema.safeParse({ sourceUrl: 'https://www.balancestudio.tv' });
  expect(result.success).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- api/contracts`
Expected: FAIL because the API contract schema does not exist.

**Step 3: Write minimal implementation**

- Add env validation and typed API contracts
- Add placeholder route handlers that return valid JSON
- Add Supabase adapter boundaries without requiring real credentials yet

**Step 4: Run test to verify it passes**

Run: `npm run test -- api`
Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add api contracts and session routes"
```

### Task 7: Compose the widget pages from the production reference

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/widget/page.tsx`
- Create: `components/widget/reference-board.tsx`
- Create: `tests/widget/widget-page.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import WidgetPage from '@/app/widget/page';

test('renders the Balance Assist guided onboarding widget', () => {
  render(<WidgetPage />);
  expect(screen.getByText(/3 of 5 essentials captured/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Start your project brief/i })).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- widget-page`
Expected: FAIL because the composed widget page is not implemented.

**Step 3: Write minimal implementation**

- Assemble the welcome, onboarding, upload, and summary states into a single polished POC view
- Use the provided visual board as the primary UI reference
- Keep the implementation static/local-state rather than overbuilding live orchestration in the first pass

**Step 4: Run test to verify it passes**

Run: `npm run test -- widget-page`
Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "feat: compose balance assist widget screens"
```

### Task 8: Verify the scaffold end-to-end

**Files:**
- Create: `tests/e2e/widget.spec.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';

test('widget landing shows human escalation', async ({ page }) => {
  await page.goto('/widget');
  await expect(page.getByRole('button', { name: 'Talk to a human' })).toBeVisible();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL because the e2e test and dev app setup are not finished yet.

**Step 3: Write minimal implementation**

- Add a minimal README with setup commands
- Make sure the widget route is stable enough for Playwright

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "test: verify balance assist widget scaffold"
```
