# Trust-First Balance Assist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task.

**Goal:** Rebuild Balance Assist as a secure, consent-led project onboarding agent with truthful human handoff, controlled memory, and measurable trust outcomes.

**Architecture:** Keep anonymous onboarding, but replace bearer session UUIDs with server-issued, expiring session capabilities. Make Supabase the canonical project state, use an outbox for producer delivery, and treat Telegram as a verified delivery channel rather than the source of truth. The widget remains project-brief and Balance-info focused; careers requests become an official-careers redirect without collecting applicant data.

**Tech Stack:** Next.js 15 route handlers, React, Vitest, Playwright, Zod, Supabase, Telegram Bot API, DeepSeek, Calendly.

**Plan target:** `docs/plans/2026-07-11-trust-first-production-remediation.md`

---

## Release Gate

Before implementation begins, temporarily disable or restrict:

- Public Telegram setup/configuration routes.
- Telegram webhook processing unless a secret token is configured.
- AI-mode uploads that forward files to Telegram.
- Claims that a producer was notified unless delivery is durable.
- Public cross-origin access to session-scoped routes.

Rotate Telegram and Supabase credentials if the live setup endpoint may have been exposed.

## Task 1: Establish Secure Configuration and Route Policy

**Files:**
- Create: `lib/security/config.ts`
- Create: `lib/security/origin.ts`
- Modify: `.env.example`
- Modify: `lib/api/route-helpers.ts`
- Test: `tests/security/origin.test.ts`

**TDD cycle:**
1. Add failing tests for approved Balance origins, rejected origins, absent admin credentials, and production webhook-secret requirements.
2. Implement `getAllowedOrigins()`, `requireAdminConfig()`, `requireTrustedOrigin()`.
3. Replace wildcard CORS with allowlisted origin reflection, `Vary: Origin`, and explicit credential handling.
4. Verify requests from an unapproved origin cannot read or mutate session data.
5. Commit: `security: restrict API origins and require privileged config`.

## Task 2: Add Durable Security, Consent, and Delivery Schema

**Files:**
- Create: `supabase/migrations/014_trust_security_foundation.sql`
- Create: `supabase/migrations/015_trust_delivery_outbox.sql`
- Test: `tests/integration/migrations-trust-foundation.test.ts`

**Schema additions:**
- `sessions`: capability_hash, capability_expires_at, consent_version, consented_at, draft, draft_version
- `processed_telegram_updates`: update_id (PK), received_at
- `handoff_outbox`: id, session_id, payload, state, idempotency_key, attempts

**TDD cycle:**
1. Apply migrations to an isolated Supabase database.
2. Assert duplicate finalization and duplicate Telegram updates are rejected.
3. Assert session capabilities and outbox rows are required.
4. Commit: `feat: add trust security and delivery schema`.

## Task 3: Secure Telegram Administration and Webhooks

**Files:**
- Modify: `app/api/telegram/setup/route.ts`
- Modify: `app/api/telegram/webhook/route.ts`
- Modify: `lib/telegram.ts`
- Create: `lib/telegram/webhook-auth.ts`
- Test: `tests/api/telegram-webhook.test.ts`
- Test: `tests/api/telegram-setup.test.ts`

**Required behavior:**
- Require admin authentication for every setup-route method.
- Never return secret values or prefixes.
- Configure Telegram `secret_token`.
- Verify `X-Telegram-Bot-Api-Secret-Token` with timing-safe comparison.
- Verify expected Telegram chat ID and authorized sender identity.
- Persist `update_id` before side effects.
- Remove the latest-session fallback.
- Quarantine unmatched updates.

**TDD cases:**
- Missing/invalid webhook secret.
- Wrong chat or unauthorized sender.
- Replayed `update_id`.
- Unthreaded or unmatched reply.
- Valid mapped reply.
- Unauthorized setup methods.

Commit: `security: authenticate Telegram administration and webhooks`.

## Task 4: Replace UUID-as-Authorization with Session Capabilities

**Files:**
- Create: `lib/security/session-capability.ts`
- Create: `lib/api/require-session.ts`
- Modify: `app/api/sessions/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/events/route.ts`
- Modify: `app/api/leads/finalize/route.ts`
- Modify: `app/api/attachments/link/route.ts`
- Modify: `app/api/telegram/{messages,relay,upload,schedule-complete}/route.ts`
- Modify: `lib/api/client.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Test: `tests/api/session-authorization.test.ts`

**Design:**
```ts
type SessionAuth = {
  sessionId: string;
  capability: string;
  expiresAt: string;
};
```

Store only a hash server-side. Send the raw capability in an HttpOnly, Secure cookie for same-origin Balance embedding. Do not retain session UUIDs in `localStorage`.

**TDD cases:**
- Session A cannot read or mutate Session B.
- Expired/revoked capability is rejected.
- Unauthenticated relay cannot send Telegram messages.
- No-session request cannot bypass rate limits.
- Reload retains only a valid session capability.

Commit: `security: authorize anonymous project sessions`.

## Task 5: Make Delivery and Approval States Truthful

**Files:**
- Modify: `app/api/leads/finalize/route.ts`
- Modify: `app/api/telegram/relay/route.ts`
- Create: `lib/handoff/outbox.ts`
- Create: `app/api/internal/handoff-dispatch/route.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/review-panel.tsx`
- Modify: `lib/api/contracts.ts`
- Test: `tests/api/leads-finalize.test.ts`
- Test: `tests/api/telegram-relay.test.ts`
- Test: `tests/widget/widget-overlay-approval-failure.test.tsx`

**Response contract:**
```ts
type HandoffOutcome = {
  persisted: boolean;
  queued: boolean;
  delivered: boolean;
  retryable: boolean;
};
```

Only claim "team notified" after a durable delivery receipt. Keep approval retryable after failures. Use the outbox to retry Telegram delivery without duplicate leads or messages.

Commit: `fix: make project approval and human delivery truthful`.

## Task 6: Add Consent-Led Session Creation and Data Disclosure

**Files:**
- Create: `components/widget/data-use-notice.tsx`
- Create: `lib/privacy/notice.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `app/api/sessions/route.ts`
- Modify: `lib/api/contracts.ts`
- Create: `app/privacy/page.tsx`
- Test: `tests/widget/data-use-notice.test.tsx`
- Test: `tests/api/sessions-route.test.ts`

**Required behavior:**
- Do not create a session on mount.
- Create a session only after the user starts an AI conversation or explicitly begins a project brief.
- Store origin/path only; strip query strings, fragments, and unnecessary referrer data.
- Persistently identify the widget as "Balance Assist, an AI assistant."
- Explain, before the relevant action, use of the LLM, producer team/Telegram, Calendly, retention, and available controls.
- Add a human-only contact option.

Commit: `feat: add consent-led project sessions and data notices`.

## Task 7: Implement Transparent Project Memory and Corrections

**Files:**
- Create: `lib/conversation/draft-versioning.ts`
- Modify: `lib/conversation/draft-schema.ts`
- Modify: `app/api/chat/route.ts`
- Create: `app/api/projects/[sessionId]/draft/route.ts`
- Create: `app/api/projects/[sessionId]/delete/route.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `lib/conversation/local-responses.ts`
- Test: `tests/conversation/draft-versioning.test.ts`
- Test: `tests/api/project-delete.test.ts`

**Required behavior:**
- Store canonical draft state and version server-side.
- Track field provenance: user-stated, inferred, confirmed, cleared.
- Support "What do you remember?" from the canonical, user-visible inventory.
- Rename current reset to "Start a new local brief."
- Provide a real deletion request flow with honest limitations.

Commit: `feat: add transparent project memory and correction controls`.

## Task 8: Rebuild Brief Readiness Around User Choice

**Files:**
- Modify: `lib/conversation/review-state.ts`
- Modify: `lib/conversation/system-prompt.ts`
- Modify: `lib/conversation/flow.ts`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/project-brief-card.tsx`
- Test: `tests/conversation/review-state.test.ts`
- Test: `tests/widget/review-panel.test.tsx`
- Test: `tests/e2e/intake.spec.ts`

**Required behavior:**
- Require a minimum viable handoff: project need, one contact method, and explicit send consent.
- Make company optional.
- Accept project type or service.
- Accept unknown timeline/budget and "prefer not to say."
- Explain why sensitive details help.
- Show section recaps for overview, objectives/audience, constraints, and assets.
- Clearly distinguish "ready to talk" from "complete brief."

Commit: `feat: support progressive trust-first project intake`.

## Task 9: Make Attachments Consent-Gated and Safe

**Files:**
- Modify: `components/widget/attachment-dropzone.tsx`
- Modify: `app/api/telegram/upload/route.ts`
- Modify: `app/api/attachments/link/route.ts`
- Create: `lib/uploads/quarantine.ts`
- Create: `lib/uploads/consent.ts`
- Modify: `lib/uploads/file-policy.ts`
- Modify: `lib/uploads/extract-text.ts`
- Test: `tests/api/telegram-upload.test.ts`
- Test: `tests/api/attachments-link.test.ts`
- Test: `tests/uploads/file-policy.test.ts`

**Required behavior:**
- Do not create Telegram topics or forward files during AI-only intake.
- Require explicit separate consent for AI analysis and producer sharing.
- Enforce file count, total request size, magic-byte/MIME validation, decompression limits, parse timeouts, and idempotency.
- Treat extracted text as untrusted data.
- Render per-file states: queued, analysing, ready to share, sent, failed, retryable.

Commit: `security: gate and harden project attachment handling`.

## Task 10: Enforce LLM Boundaries and Careers Redirect

**Files:**
- Modify: `app/api/chat/route.ts`
- Modify: `lib/conversation/system-prompt.ts`
- Modify: `lib/conversation/tool-schema.ts`
- Modify: `lib/conversation/reply-sanitize.ts`
- Create: `lib/conversation/careers-redirect.ts`
- Create: `tests/evals/trust-safety-corpus.jsonl`
- Test: `tests/api/chat-route.test.ts`
- Test: `tests/conversation/careers-redirect.test.ts`
- Test: `tests/evals/trust-safety.test.ts`

**Required behavior:**
- Never interpolate browser-controlled draft/history into the system prompt.
- Pass only validated, server-owned state.
- Delimit every user message, URL, and attachment extraction as untrusted data.
- Reject client-supplied assistant/system history.
- Add commitment checks for pricing, availability, guaranteed timelines, contracts, and legal advice.
- Route careers intent to the official Balance careers URL with no CV capture.

Commit: `security: enforce LLM trust boundaries and careers redirect`.

## Task 11: Fix Mobile, Accessibility, and Calendly Integrity

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/attachment-dropzone.tsx`
- Modify: `components/chat/calendly-embed.tsx`
- Create: `components/widget/mobile-brief-tabs.tsx`
- Test: `tests/widget/widget-overlay-a11y.test.tsx`
- Test: `tests/chat/calendly-embed.test.tsx`
- Test: `tests/e2e/mobile-intake.spec.ts`

**Required behavior:**
- Use Chat/Brief tabs or stacked layout below the mobile breakpoint.
- Add labelled dialog semantics, focus entry/restore, Escape behavior, keyboard upload access, live chat/status announcements.
- Validate Calendly `postMessage` origin and source.
- Use one configured Calendly URL/duration across every entry point.
- Treat browser scheduling events as UI hints; use verified server confirmation.

Commit: `fix: make widget accessible and mobile-safe`.

## Task 12: Build Producer Handoff, Routing, and SLA Rules

**Files:**
- Modify: `lib/qualification/score.ts`
- Modify: `lib/qualification/next-step.ts`
- Create: `lib/handoff/routing.ts`
- Create: `lib/handoff/packet.ts`
- Modify: `app/api/leads/finalize/route.ts`
- Modify: `app/api/telegram/relay/route.ts`
- Modify: `lib/conversation/topic-status.ts`
- Test: `tests/qualification/routing.test.ts`
- Test: `tests/handoff/packet.test.ts`

**Required behavior:**
- Route high-budget, urgent, ambiguous, repeat-failure, and frustrated users to priority review.
- Never penalise urgency as lower fit.
- Create Telegram topics only after explicit producer transfer.
- Use neutral case IDs in topic titles.
- Send a structured handoff packet with confirmed facts, unknowns, attachments, consent scope, routing reason.

Commit: `feat: add verified producer handoff and priority routing`.

## Task 13: Instrument Trust and Establish Quality Gates

**Files:**
- Modify: `lib/logger.ts`
- Create: `lib/observability/events.ts`
- Modify: `app/api/events/route.ts`
- Modify: all mutation routes under `app/api/`
- Create: `docs/trust-metrics.md`
- Create: `docs/producer-review-runbook.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `playwright.config.ts`
- Test: `tests/observability/logger.test.ts`
- Test: `tests/api/events-route.test.ts`

**Required behavior:**
- Wire request IDs through every route.
- Redact PII, message text, file text, URLs, and credentials.
- Version and allowlist event schemas.
- Measure consent, correction, reset/deletion, delivery, escalation reason, producer response time, fallback rate.
- Add LLM safety/evaluation thresholds.
- Run production-mode E2E, mobile, accessibility, migration, webhook, authorization, and dependency-failure tests in CI.

Commit: `feat: add trust observability and release gates`.

---

## Final Acceptance Criteria

- No forged Telegram message can appear as a Balance team message.
- No route accepts a UUID alone as authorization.
- No personal/project data is persisted or shared before the relevant notice and consent.
- No visible delivery state claims a producer was notified without durable evidence.
- Users can inspect, correct, clear, start over, and request deletion of project data.
- Users can submit a useful brief without fabricated company/budget/timeline data.
- Careers requests redirect safely without applicant-data capture.
- The widget remains usable at 320px and with keyboard/screen-reader navigation.
- Every thesis element has automated evidence and at least one operating metric.
