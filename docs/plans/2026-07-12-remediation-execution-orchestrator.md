# Trust-First Remediation: Execution Orchestrator Prompt

Copy the prompt below into the code-execution AI session.

---

You are the execution lead for the `fix/trust-first-remediation` branch in `D:\Development Projects\Balance-Assist`.

Your objective is to resolve the blocking QA, scope-review, and code-review findings below. Work only on this branch. Do **not** merge, rebase, push, create a PR, discard changes, or commit unless explicitly asked by the human owner.

## Operating Rules

1. Start by inspecting `git status`, `git diff main`, the current tests, and the relevant implementation before editing.
2. Use TDD for every fix: add a focused failing regression test, run it to observe the expected failure, implement the smallest correct change, then run the focused test again.
3. Preserve existing user changes. Do not reset, checkout, or revert unrelated work.
4. Work in dependency order. Do not begin a later wave while an earlier wave has unresolved critical/high findings.
5. After each wave, run focused tests and report changed files, tests run, and unresolved risks.
6. At the end, run `npm run lint`, `npm run build`, `npx vitest run`, `npm run test:e2e`, `npx tsc --noEmit`, and `git diff --check`.
7. Do not claim completion unless every required verification command has passed. If a command fails, report the exact failure and keep working.
8. Use subagents only for independent workstreams. Do not dispatch parallel agents that edit the same files.

## Required Outcome

The final implementation must satisfy these release invariants:

- No privileged/internal endpoint is accessible when its secret is missing.
- No route accepts a session UUID alone as authorization.
- No LLM tool call can create consent, producer sharing permission, or a human handoff authorization.
- No Telegram update can appear as a team message unless its configured secret, chat, and sender are verified.
- No attachment reaches Telegram during AI-only intake, even if the browser supplies producer-sharing fields.
- No approval, relay, schedule, or delivery UI reports success without durable evidence.
- Canonical project data, corrections, reset, deletion, and capability revocation behave consistently server-side.
- All planned routing, packet, observability, CI, mobile, and accessibility requirements are implemented end-to-end.

## Wave 1: Fail Closed and Close Authorization Bypasses

Implement these together because they are security boundaries.

### Privileged routes

Fix the fail-open behavior in:

- `app/api/internal/handoff-dispatch/route.ts`
- `app/api/internal/uploads/route.ts`
- `app/api/telegram/cleanup-topics/route.ts`
- `app/api/telegram/list-topics/route.ts`
- `app/api/sessions/inspect/route.ts`

Requirements:

- Required secrets must be mandatory, not optional. Missing secret configuration must return a safe service/configuration error; an absent header must return `401`.
- Use timing-safe comparison for secrets where practical.
- The public current-session inspect path may use a verified session capability cookie, but arbitrary `?id=` inspection must be privileged and fail closed.
- Add route-level regression tests for both missing configuration and missing/invalid authorization.

### Session and CSRF/origin protection

Fix:

- Raw capabilities returned in JSON from `app/api/sessions/route.ts`.
- Cookie handling in `app/api/sessions/route.ts` and `lib/api/require-session.ts`.
- Missing mutation-origin validation across cookie-authenticated routes.

Requirements:

- Return the capability only through an HttpOnly cookie; do not return it in JSON.
- Use a production-safe host-only cookie name/attributes and reject ambiguous duplicate capability cookies.
- Enforce trusted Origin on cookie-authenticated state-changing requests. CORS headers alone are insufficient.
- Keep same-origin production widget behavior working.
- Add tests for cross-origin mutation rejection, no capability in response JSON, and invalid/missing cookie capability rejection.

### Telegram webhook identity

Fix `app/api/telegram/webhook/route.ts` and any supporting schema/helpers.

Requirements:

- Missing `TELEGRAM_CHAT_ID` or allowed-sender configuration must fail closed for production webhook processing.
- Verify webhook secret before processing, then verify chat and sender identity before any user-visible side effect.
- Persist/query enough Telegram chat identity to prevent cross-chat thread/message mapping confusion.
- Add tests covering absent configuration, wrong chat, wrong sender, replay, and a valid mapped update.

Wave 1 acceptance:

- The privileged-route tests, session authorization tests, origin/CSRF tests, and webhook tests pass.
- An unauthenticated caller cannot read session data, dispatch handoffs, list uploads, or delete Telegram topics.

## Wave 2: Explicit Consent and Canonical Project State

### Consent model

Fix consent creation and use across:

- `lib/conversation/tool-schema.ts`
- `lib/conversation/draft-schema.ts`
- `app/api/chat/route.ts`
- `components/widget/widget-overlay.tsx`
- `app/api/leads/finalize/route.ts`
- `app/api/sessions/route.ts`

Requirements:

- Remove `consentToShare` from LLM-controlled tool updates and draft sanitization.
- Implement an authenticated, deterministic consent transition based on explicit user input/UI action. Persist it server-side with timestamp/version/provenance.
- Finalization must derive the handoff brief from canonical server state, not the browser-supplied `leadDraft` body.
- Require server-recorded explicit send consent before finalization.
- Session metadata must not persist before the notice/consent gate.
- Add tests proving an LLM tool call cannot create consent, a user-confirmed consent can, and modified client payloads cannot alter a finalized handoff.

### Canonical corrections, reset, deletion

Fix:

- `components/widget/widget-overlay.tsx`
- `app/api/projects/[sessionId]/draft/route.ts`
- `app/api/projects/[sessionId]/delete/route.ts`
- `app/api/chat/route.ts`

Requirements:

- Wire review-panel edits to the authenticated canonical draft endpoint with version-aware conflict handling.
- Implement a real clear/reset operation that updates server canonical state and revokes or rotates the session capability as appropriate.
- Do not say memory was cleared unless the server action completed.
- Implement a durable deletion queue/request model with truthful user copy and an operator-consumable deletion status. Do not claim downstream Telegram/backups were deleted unless actually performed.
- Add end-to-end route/widget tests for edit persistence, reset behavior, session reload, and deletion request state.

Wave 2 acceptance:

- A client cannot create or modify consent through an LLM response or forged lead payload.
- Corrections and reset survive/reconcile correctly across a page reload.
- The chat system prompt uses only canonical, authenticated server state.

## Wave 3: Attachment Quarantine and Truthful Delivery

### Attachment safety

Fix:

- `app/api/telegram/upload/route.ts`
- `app/api/attachments/link/route.ts`
- `components/widget/attachment-dropzone.tsx`
- `lib/uploads/quarantine.ts`
- `lib/uploads/extract-text.ts`

Requirements:

- Validate every server-received file buffer with `validateFile()` and use the detected MIME rather than browser metadata.
- Add decompression/parse-size and parse-time limits before extracting text. Treat extracted text as untrusted.
- Enforce idempotency for repeat uploads.
- Separate analysis consent from producer-share consent authoritatively on the server.
- AI-only intake may persist quarantined/analysed material but must never create a Telegram topic or forward the file.
- Telegram forwarding is allowed only after an explicit producer-transfer state, separate producer-share consent, and a valid session capability.
- Links must follow the same transfer/consent model.
- Add malicious magic-byte, repeat-upload, analysis-only, producer-transfer, and extraction-limit tests.

### Delivery truthfulness and outbox processing

Fix:

- `app/api/leads/finalize/route.ts`
- `app/api/telegram/relay/route.ts`
- `app/api/telegram/schedule-complete/route.ts`
- `lib/handoff/outbox.ts`
- `app/api/internal/handoff-dispatch/route.ts`
- `components/widget/review-panel.tsx`
- `components/widget/widget-overlay.tsx`

Requirements:

- Return `ok: false` for failed persistence or failed relay delivery. Do not collapse delivery states into a boolean success.
- Use an atomic outbox claim/lease before sending to avoid duplicate concurrent dispatch.
- Add a secure scheduled invocation mechanism for dispatch (platform cron or equivalent) and document its required configuration.
- Ensure retry/backoff/escalation work end-to-end.
- Mark UI as delivered only after a durable delivery receipt; show queued/retryable/failed states otherwise.
- Calendly browser events are UI hints only. Do not write a team message or declare server confirmation without a verified server-side booking signal.
- Add concurrency, retry, persistence-failure, Telegram-failure, and scheduler integration tests.

Wave 3 acceptance:

- Spoofed file content is rejected.
- Intake uploads never create Telegram topics.
- Concurrent dispatch cannot double-send one handoff.
- Failed relay, scheduling, and lead persistence never appear as successful handoffs.

## Wave 4: Complete Missing Plan Scope

### Producer routing and packet (Task 12)

Implement the planned files and behavior:

- Create `lib/handoff/routing.ts`.
- Create `lib/handoff/packet.ts`.
- Add `tests/qualification/routing.test.ts` and `tests/handoff/packet.test.ts`.
- Update qualification, handoff, and topic generation.

Requirements:

- Urgency must route to priority review, never reduce fit.
- Route high-budget, ambiguous, repeat-failure, and frustrated users to priority review with explicit reasons.
- Create Telegram topics only at explicit producer transfer.
- Use neutral case IDs, not contact names or companies, in topic titles.
- Handoff packets include confirmed facts, unknowns, attachment status, consent scope, and routing reason.

### Observability and release gates (Task 13)

Implement the planned files and integration:

- Create `lib/observability/events.ts`.
- Wire request IDs, redaction, and versioned/allowlisted event schemas through mutation routes.
- Wire trust metrics into real flows, not just unit tests.
- Create `docs/trust-metrics.md` and `docs/producer-review-runbook.md`.
- Update `.github/workflows/ci.yml` to run production build, strict typecheck, unit tests, Playwright E2E, mobile/accessibility coverage, migration integration, auth/webhook, and dependency-failure gates.

Requirements:

- Never log PII, message text, URLs, file contents, credentials, raw capabilities, or signed URLs.
- Measure consent, correction, reset/deletion, delivery, escalation, producer response time, and LLM fallback.
- Update existing E2E intake tests to complete the notice/start gate; add mobile coverage.
- Fix all `npx tsc --noEmit` errors and `git diff --check` whitespace failures.

Wave 4 acceptance:

- Task 12 and Task 13 files/behavior/tests are present and used in production paths.
- `npm run test:e2e` passes.
- `npx tsc --noEmit` passes.
- CI exercises the stated release gates.

## Accessibility and Calendly Follow-Up

Complete these while touching the widget:

- Add `aria-modal`, focus restoration, and focus containment for all modal states, including mobile and upload policy.
- Make upload controls keyboard accessible with labelled buttons/usable hidden inputs.
- Implement ARIA tab keyboard navigation and keep controlled panels addressable.
- Validate any Calendly URL before passing it to an iframe or third-party initializer. Use one configured URL and consistent duration copy.
- Ensure the calendar works at 320px without clipping.

## Final Verification Checklist

Run and include the full output summary for:

```powershell
npm run lint
npx tsc --noEmit
npm run build
npx vitest run
npm run test:e2e
```

Before handing work back, perform a final read-only review against `docs/plans/2026-07-11-trust-first-remediation.md`. Report:

1. Changed files grouped by wave.
2. Each acceptance criterion and the automated evidence proving it.
3. Remaining risks, if any.
4. Exact verification results.

Do not merge, push, commit, or create a pull request.
