# Thesis Intake Spec Findings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct canonical four-stage progression, preserve exact first project wording, and block provider-generated internal status language.

**Architecture:** Add `referencesStatus` to the existing versioned JSON draft and derive references/contact progression independently from canonical values. Keep reference URLs in `reference_links`, persist status through the existing draft RPC, preserve first user scope verbatim at the tool boundary, and enforce internal-language filtering only on provider output in the deterministic reply sanitizer.

**Tech Stack:** TypeScript, Zod, React 19, Next.js route handlers, Vitest/Testing Library.

---

### Task 1: Canonical progression and reference status

1. Add failing stage, next-step, schema, route, and widget tests proving service is optional and `referencesStatus` controls the references offer independently from contact fields.
2. Run focused tests and confirm failures are caused by the missing field and current service/contact proxy logic.
3. Add required `referencesStatus: '' | 'added' | 'skipped'` to `LeadDraft` and defaults; wire tool/draft schemas, captured fields, and prompt ordering.
4. Persist `added` only after successful link persistence and `skipped` only after explicit Skip through the existing canonical draft update path.
5. Run focused tests to green.

### Task 2: Exact original wording

1. Add a failing tool-boundary test where the model emits a substring of a longer first user answer.
2. Require first persisted `projectScope` to equal `userMessage.trim()` and preserve a prior non-empty scope unchanged.
3. Run tool and route tests to green.

### Task 3: Provider-only internal-language sanitizer

1. Add failing sanitizer and route tests for provider replies asserting score, qualification, CRM, Telegram, or revision status alongside tool updates.
2. Replace matching provider output with bounded neutral brief language and return an empty draft update object.
3. Prove legitimate user questions and echoed user terms are not blocked before provider handling.
4. Run sanitizer and route tests to green.

### Task 4: Verification and commit

1. Run all focused suites and the full Vitest suite.
2. Run `npx tsc --noEmit`, `npm run lint`, and `git diff --check`.
3. Review status/diff/log, stage only intended files, and commit.
