# Trust-Centered Widget Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore session creation and human contact, then deliver a thesis-aligned, accessible, reference-inspired Balance Assist journey with truthful data, memory, handoff, and recovery states.

**Architecture:** Preserve the durable Next.js, Supabase, Telegram, Monday, and Calendly architecture. Fix deployment readiness and relay correlation first, separate the AI and human entry paths, then simplify the large overlay into explicit phase controllers while applying the approved trust content and visual system.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase/PostgreSQL, Telegram Bot API, Monday GraphQL API, Calendly, Vercel, GitHub Actions, Vitest, Playwright.

---

## Phase 1: Restore Production Reliability

### Task 1: Production Session Readiness

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `lib/security/origin.ts`
- Modify: `lib/api/route-helpers.ts`
- Modify: `.github/workflows/production-release.yml`
- Modify: `scripts/apply-production-crm-migrations.d.mts`
- Test: `tests/security/origin.test.ts`
- Test: `tests/api/origin-enforcement.test.ts`
- Test: `tests/integration/release-workflow.test.ts`
- Test: `tests/integration/production-crm-migration-policy.test.ts`

**Step 1: Write failing configuration-contract tests**

Require production readiness to verify:

```text
TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for
ALLOWED_ORIGINS includes https://balance-assist.vercel.app
CORS allows x-request-id and x-session-id
```

Add a type assertion for the existing `artifactPath` CRM runner option.

**Step 2: Run focused tests and typecheck**

Run:

```powershell
npx vitest run tests/security/origin.test.ts tests/api/origin-enforcement.test.ts tests/integration/release-workflow.test.ts tests/integration/production-crm-migration-policy.test.ts
npx tsc --noEmit
```

Expected: FAIL on missing readiness/CORS coverage and the `artifactPath` declaration.

**Step 3: Implement the minimal runtime contract**

- Add the production Vercel origin to the explicit deployment configuration, not as a wildcard.
- Permit `x-request-id` and `x-session-id` in CORS.
- Make the protected release workflow fail before promotion when the trusted-IP selector or supported origins are absent.
- Fix the runner declaration without changing migration behavior.

**Step 4: Configure Vercel and redeploy**

Set production values through Vercel without printing secrets:

```powershell
TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for
ALLOWED_ORIGINS=https://balancestudio.tv,https://www.balancestudio.tv,https://balance-assist.vercel.app
```

Redeploy the current verified `main` commit.

**Step 5: Run a production-like session smoke**

Post an empty-PII synthetic consent/session request from the supported origin.
Require `200`, `persisted: true`, and an HttpOnly capability cookie. Request
deletion for the synthetic session after the probe.

**Step 6: Commit**

```powershell
git add .env.example README.md lib/security/origin.ts lib/api/route-helpers.ts .github/workflows/production-release.yml scripts/apply-production-crm-migrations.d.mts tests/security/origin.test.ts tests/api/origin-enforcement.test.ts tests/integration/release-workflow.test.ts tests/integration/production-crm-migration-policy.test.ts
git commit -m "fix: enforce production session readiness"
```

### Task 2: Human Relay Delivery And Reply Correlation

**Files:**
- Modify: `app/api/internal/handoff-dispatch/route.ts`
- Modify: `lib/handoff/outbox.ts`
- Modify: `lib/telegram.ts`
- Modify: `app/api/telegram/webhook/route.ts`
- Test: `tests/api/handoff-dispatch-events.test.ts`
- Test: `tests/api/telegram-webhook.test.ts`
- Test: `tests/integration/release-proof-http.test.ts`

**Step 1: Write failing end-to-end relay tests**

Cover:

```text
relay persisted -> Telegram topic created/reused -> send in thread
-> provider message ID stored -> reply correlated by thread/message ID
```

Require topic failure to schedule a retry and prohibit an unthreaded send.

**Step 2: Run focused tests**

```powershell
npx vitest run tests/api/handoff-dispatch-events.test.ts tests/api/telegram-webhook.test.ts tests/integration/release-proof-http.test.ts
```

Expected: FAIL because dispatch neither creates topics nor persists the provider
message receipt.

**Step 3: Implement topic and receipt handling**

- Call `ensureTelegramTopic` before relay/approval delivery.
- Send with the resolved thread ID.
- Persist the returned Telegram message ID on the matching `human_messages` row.
- Preserve thread and parent-message fallback lookup in the webhook.
- Keep provider errors redacted and retryable.

**Step 4: Run focused tests and commit**

```powershell
git add app/api/internal/handoff-dispatch/route.ts lib/handoff/outbox.ts lib/telegram.ts app/api/telegram/webhook/route.ts tests/api/handoff-dispatch-events.test.ts tests/api/telegram-webhook.test.ts tests/integration/release-proof-http.test.ts
git commit -m "fix: restore threaded human relay"
```

## Phase 2: Restore Human Agency And Honest States

### Task 3: AI-Or-Human Entry Before AI Consent

**Files:**
- Modify: `components/widget/data-use-notice.tsx`
- Modify: `components/onboarding/welcome-actions.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `lib/privacy/notice.ts`
- Modify: `lib/api/contracts.ts`
- Modify: `lib/api/client.ts`
- Modify: `app/api/sessions/route.ts`
- Test: `tests/widget/data-use-notice.test.tsx`
- Test: `tests/widget/widget-overlay-session.test.tsx`
- Test: `tests/api/sessions-route.test.ts`
- Test: `tests/e2e/widget.spec.ts`

**Step 1: Write failing entry-path tests**

Assert that before AI processing the user can choose:

```text
Build a brief with AI
Talk to the team without AI
Leave
```

The human route must create a first-party relay session without recording AI
analysis consent or calling `/api/chat`.

**Step 2: Run focused tests and verify RED**

```powershell
npx vitest run tests/widget/data-use-notice.test.tsx tests/widget/widget-overlay-session.test.tsx tests/api/sessions-route.test.ts
```

**Step 3: Implement the entry model**

- Replace coercive `I understand` with equal AI/human choices.
- Record AI consent only after `Continue with AI`.
- Keep human messages subject to a separate Telegram disclosure.
- Keep email and Calendly visible if session creation fails.

**Step 4: Verify and commit**

```powershell
git add components/widget/data-use-notice.tsx components/onboarding/welcome-actions.tsx components/widget/widget-overlay.tsx lib/privacy/notice.ts lib/api/contracts.ts lib/api/client.ts app/api/sessions/route.ts tests/widget/data-use-notice.test.tsx tests/widget/widget-overlay-session.test.tsx tests/api/sessions-route.test.ts tests/e2e/widget.spec.ts
git commit -m "feat: offer a human path before AI consent"
```

### Task 4: Honest Human Relay UX And Fallbacks

**Files:**
- Modify: `components/widget/use-team-relay.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `lib/api/client.ts`
- Test: `tests/widget/widget-state-controllers.test.tsx`
- Test: `tests/widget/widget-overlay-session.test.tsx`
- Test: `tests/api/telegram-relay-events.test.ts`
- Test: `tests/e2e/widget.spec.ts`

**Step 1: Write failing state tests**

Test distinct `saved`, `queued`, `delivered`, and `replied` states, close/reopen,
retry, polling outage, and the direct email/Calendly fallback.

**Step 2: Implement explicit relay state**

- Never map persistence to delivery.
- Remove fake human typing.
- Keep composer and escape path after close/reopen.
- Disable actions while genuinely in flight and announce status changes.

**Step 3: Verify and commit**

```powershell
npx vitest run tests/widget/widget-state-controllers.test.tsx tests/widget/widget-overlay-session.test.tsx tests/api/telegram-relay-events.test.ts
git add components/widget/use-team-relay.ts components/widget/widget-overlay.tsx components/widget/widget-overlay-parts.tsx lib/api/client.ts tests/widget/widget-state-controllers.test.tsx tests/widget/widget-overlay-session.test.tsx tests/api/telegram-relay-events.test.ts tests/e2e/widget.spec.ts
git commit -m "fix: make human handoff states truthful"
```

## Phase 3: Align With The Thesis Trust Scope

### Task 5: NDA Guard And Pinned AI Provider Disclosure

**Files:**
- Modify: `lib/privacy/notice.ts`
- Modify: `lib/conversation/system-prompt.ts`
- Modify: `lib/conversation/reply-sanitize.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `components/widget/attachment-dropzone.tsx`
- Modify: `docs/ai-provider-governance.md`
- Test: `tests/api/chat-route.test.ts`
- Test: `tests/conversation/system-prompt.test.ts`
- Test: `tests/conversation/reply-sanitize.test.ts`
- Test: `tests/widget/attachment-dropzone.test.tsx`

**Step 1: Write failing tests**

Require NDA/confidentiality diversion before provider processing and file
selection. Require the configured provider to be explicit and prohibit silent
cross-provider fallback.

**Step 2: Implement deterministic safeguards**

- Detect NDA/confidential/sensitive intent before `/api/chat` provider calls.
- Offer the human-only route without echoing sensitive content.
- Name DeepSeek in disclosure while it is the configured provider.
- State actual file formats, limits, extraction behavior, and provider flow.
- Keep pricing, timeline, availability, contract, and legal boundaries in both
  prompt and deterministic output sanitization.

**Step 3: Verify and commit**

```powershell
npx vitest run tests/api/chat-route.test.ts tests/conversation/system-prompt.test.ts tests/conversation/reply-sanitize.test.ts tests/widget/attachment-dropzone.test.tsx
git add lib/privacy/notice.ts lib/conversation/system-prompt.ts lib/conversation/reply-sanitize.ts app/api/chat/route.ts components/widget/attachment-dropzone.tsx docs/ai-provider-governance.md tests/api/chat-route.test.ts tests/conversation/system-prompt.test.ts tests/conversation/reply-sanitize.test.ts tests/widget/attachment-dropzone.test.tsx
git commit -m "feat: enforce confidential-intake boundaries"
```

### Task 6: Thesis-Aligned Intake And Review

**Files:**
- Modify: `lib/conversation/flow.ts`
- Modify: `lib/conversation/system-prompt.ts`
- Modify: `lib/conversation/review-state.ts`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Test: `tests/conversation/system-prompt.test.ts`
- Test: `tests/widget/review-panel.test.tsx`
- Test: `tests/widget/widget-overlay-intent.test.tsx`
- Test: `tests/e2e/intake.spec.ts`
- Test: `tests/e2e/mobile-intake.spec.ts`

**Step 1: Write failing content and flow tests**

Require four stages, rationales for constraints, valid uncertainty/skip states,
periodic summaries, mobile-aware review copy, and no client-visible automated
qualification language.

**Step 2: Implement the four-stage flow**

- Project and objective.
- Audience and intended outputs.
- Timeline and budget with reasons.
- References and contact.

Replace `8 of 8` with `Core brief ready` plus optional details. Label generated
interpretation `AI-drafted summary` and retain original wording.

**Step 3: Fix retry and reapproval state**

Ensure a failed approval re-enables the CTA and approve -> edit -> reapprove
works without remounting.

**Step 4: Verify and commit**

```powershell
npx vitest run tests/conversation/system-prompt.test.ts tests/widget/review-panel.test.tsx tests/widget/widget-overlay-intent.test.tsx
git add lib/conversation/flow.ts lib/conversation/system-prompt.ts lib/conversation/review-state.ts components/widget/review-panel.tsx components/widget/widget-overlay-parts.tsx components/widget/widget-overlay.tsx tests/conversation/system-prompt.test.ts tests/widget/review-panel.test.tsx tests/widget/widget-overlay-intent.test.tsx tests/e2e/intake.spec.ts tests/e2e/mobile-intake.spec.ts
git commit -m "feat: align intake with thesis trust principles"
```

### Task 7: Memory, Consent Withdrawal, And Deletion Freeze

**Files:**
- Create: `supabase/migrations/054_trust_centered_session_controls.sql`
- Create: `supabase/production-trust-controls-054.sql`
- Create: `.github/workflows/production-trust-migrations.yml`
- Create: `scripts/apply-production-trust-migrations.mjs`
- Modify: `app/api/projects/[sessionId]/delete/route.ts`
- Modify: `app/api/projects/[sessionId]/reset/route.ts`
- Modify: `app/api/projects/[sessionId]/consent/route.ts`
- Modify: `lib/api/client.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Test: `tests/privacy/session-consent.test.ts`
- Test: `tests/privacy/durable-deletion-migration.test.ts`
- Test: `tests/api/project-delete.test.ts`
- Test: `tests/integration/production-migration-policy.test.ts`

**Step 1: Write failing database-policy tests**

Require one atomic deletion RPC to freeze the session, append consent
withdrawals, suppress unsent handoffs, create/reuse the deletion job, and return
a receipt/status. Require chat/finalization to reject deletion-requested sessions.

**Step 2: Implement migration `054` and protected artifact**

Use the established reviewed-hash, immutable-main, Supabase Management API, and
protected-environment pattern. Do not route function replacement through the
ordinary expand-only migration workflow.

**Step 3: Add visible controls**

Expose view memory, clear editable draft, withdraw transfer consent, request
deletion, and deletion status. Copy must distinguish each operation and avoid a
24-hour completion guarantee.

**Step 4: Verify and commit**

```powershell
npx vitest run tests/privacy/session-consent.test.ts tests/privacy/durable-deletion-migration.test.ts tests/api/project-delete.test.ts tests/integration/production-migration-policy.test.ts
git add supabase/migrations/054_trust_centered_session_controls.sql supabase/production-trust-controls-054.sql .github/workflows/production-trust-migrations.yml scripts/apply-production-trust-migrations.mjs app/api/projects/[sessionId]/delete/route.ts app/api/projects/[sessionId]/reset/route.ts app/api/projects/[sessionId]/consent/route.ts lib/api/client.ts components/widget/widget-overlay.tsx tests/privacy/session-consent.test.ts tests/privacy/durable-deletion-migration.test.ts tests/api/project-delete.test.ts tests/integration/production-migration-policy.test.ts
git commit -m "feat: add trustworthy session controls"
```

## Phase 4: Reference-Inspired UI And Accessibility

### Task 8: Visual System And Responsive Shell

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `lib/brand-tokens.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/widget-header.tsx`
- Modify: `components/widget/widget-footer.tsx`
- Test: `tests/widget/widget-overlay-a11y.test.tsx`
- Test: `tests/e2e/widget.spec.ts`
- Test: `tests/e2e/mobile-intake.spec.ts`

**Step 1: Add visual behavior tests**

Cover launcher label, explicit AI header state, desktop rail, full-screen mobile
sheet, mobile Chat/Brief guidance, 44px targets, and reduced-motion classes.

**Step 2: Implement the visual direction**

- Charcoal/black panels and restrained gold accents.
- High-contrast thin borders and visible focus.
- Condensed headings, readable body, sparse editorial serif.
- Minimal radii, no excessive glow, no fake presence cues.
- CSS variables/classes instead of expanding inline-style duplication.

**Step 3: Verify screenshots and commit**

```powershell
npx playwright test tests/e2e/widget.spec.ts tests/e2e/mobile-intake.spec.ts
git add app/globals.css app/layout.tsx lib/brand-tokens.ts components/widget/widget-overlay.tsx components/widget/widget-overlay-parts.tsx components/widget/review-panel.tsx components/widget/widget-header.tsx components/widget/widget-footer.tsx tests/widget/widget-overlay-a11y.test.tsx tests/e2e/widget.spec.ts tests/e2e/mobile-intake.spec.ts
git commit -m "feat: apply Balance editorial widget system"
```

### Task 9: Accessibility And Interaction Resilience

**Files:**
- Modify: `components/widget/use-dialog-focus.ts`
- Modify: `components/chat/calendly-embed.tsx`
- Modify: `components/chat/message-bubble.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Create: `tests/e2e/widget-accessibility.spec.ts`
- Test: `tests/chat/calendly-embed.test.tsx`
- Test: `tests/widget/widget-overlay-a11y.test.tsx`

**Step 1: Write failing accessibility tests**

Test Calendly iframe entry, focus restoration, speaker labels, named transcript,
visible input labels, mobile-tab error visibility, reduced motion, zoom/reflow,
and active controls outside inert subtrees.

**Step 2: Implement accessibility corrections**

Do not replace visible names with unrelated `aria-label` values. Use
descriptions for disabled reasons. Restore focus after inline editing and modal
closure.

**Step 3: Run axe, keyboard, and viewport tests**

```powershell
npx vitest run tests/chat/calendly-embed.test.tsx tests/widget/widget-overlay-a11y.test.tsx
npx playwright test tests/e2e/widget-accessibility.spec.ts
```

**Step 4: Commit**

```powershell
git add components/widget/use-dialog-focus.ts components/chat/calendly-embed.tsx components/chat/message-bubble.tsx components/widget/widget-overlay.tsx components/widget/widget-overlay-parts.tsx tests/e2e/widget-accessibility.spec.ts tests/chat/calendly-embed.test.tsx tests/widget/widget-overlay-a11y.test.tsx
git commit -m "fix: make widget interactions accessible"
```

## Phase 5: Trust Measurement And Release Proof

### Task 10: Trust-Oriented Feedback

**Files:**
- Modify: `app/api/events/route.ts`
- Modify: `lib/observability/events.ts`
- Create: `components/widget/trust-feedback.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `docs/trust-metrics.md`
- Test: `tests/api/events-route.test.ts`
- Test: `tests/observability/events.test.ts`
- Create: `tests/widget/trust-feedback.test.tsx`

**Step 1: Write failing event/privacy tests**

Add bounded events for clarity/helpfulness, comfort, willingness to reuse, and
human escalation. Never log free text, transcript content, contact data, or
provider errors.

**Step 2: Implement a lightweight feedback prompt**

Use `Was this clear?` with `Yes`, `Not quite`, and an optional separately
consented comment path that is not part of telemetry.

**Step 3: Verify and commit**

```powershell
npx vitest run tests/api/events-route.test.ts tests/observability/events.test.ts tests/widget/trust-feedback.test.tsx
git add app/api/events/route.ts lib/observability/events.ts components/widget/trust-feedback.tsx components/widget/widget-overlay.tsx docs/trust-metrics.md tests/api/events-route.test.ts tests/observability/events.test.ts tests/widget/trust-feedback.test.tsx
git commit -m "feat: measure trust without collecting content"
```

### Task 11: Full Release Proof And Expert Re-Review

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/production-release.yml`
- Modify: `docs/producer-review-runbook.md`
- Modify: `docs/deletion-processing-runbook.md`
- Modify: `docs/monday-crm-runbook.md`
- Test: `tests/integration/ci-workflow.test.ts`
- Test: `tests/integration/release-proof-http.test.ts`
- Test: `tests/integration/release-proof-journey.test.ts`

**Step 1: Make production proofs mandatory**

Require typecheck, build, full unit suite, database suite, real session smoke,
human relay/topic/reply proof, deletion freeze, accessibility E2E, and production
configuration readiness before promotion.

**Step 2: Run complete verification**

```powershell
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run test:db
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

**Step 3: Dispatch independent final reviews**

Require separate product/UX, engineering, accessibility, conversation, and
trust/privacy reviewers. Address every P0/P1 finding and rerun the relevant
review after each correction.

**Step 4: Production smoke and rollout**

- Deploy with immutable commit evidence.
- Verify both entry paths on desktop and mobile.
- Confirm no NDA sample reaches the provider.
- Confirm human message queued/delivered/replied states.
- Confirm deletion request freezes new processing.
- Sample trust events for schema compliance only.

**Step 5: Commit release documentation**

```powershell
git add .github/workflows/ci.yml .github/workflows/production-release.yml docs/producer-review-runbook.md docs/deletion-processing-runbook.md docs/monday-crm-runbook.md tests/integration/ci-workflow.test.ts tests/integration/release-proof-http.test.ts tests/integration/release-proof-journey.test.ts
git commit -m "chore: require trust-centered release proof"
```
