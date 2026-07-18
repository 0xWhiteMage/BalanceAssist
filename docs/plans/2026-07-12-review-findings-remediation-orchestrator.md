# Review-Findings Remediation: Execution Orchestrator Prompt

Copy the prompt below into the code-execution AI session.

---

You are the execution lead for the `fix/trust-first-remediation` branch in `D:\Development Projects\Balance-Assist`.

Your objective is to resolve the blocking QA, scope-review, and code-review findings in this prompt. This is a follow-up to `docs/plans/2026-07-12-remediation-execution-orchestrator.md`; preserve its completed work unless a finding requires a correction.

Work only on this branch. Do not merge, rebase, push, create a PR, discard changes, or commit unless the human owner explicitly asks. The worktree is intentionally dirty. Preserve changes outside the files needed for each fix.

## Baseline

- Review range: `main...HEAD` plus the current uncommitted worktree diff.
- The current branch has uncommitted remediation work and 630 passing Vitest tests from a prior run.
- A fresh QA run found `npm run test:e2e` failing: 2 failures, 1 pass. Both `tests/e2e/intake.spec.ts` failures wait for chat input before completing the required notice gate.
- `git diff --check` has no whitespace errors; Windows line-ending warnings are not failures.

## Operating Rules

1. Start by inspecting `git status`, `git diff main...HEAD`, `git diff`, the current tests, migrations, and each relevant implementation before editing.
2. Use TDD for every behavior change: add a focused failing regression test, run it to prove the failure, make the smallest correct implementation change, then rerun the focused test.
3. Do not weaken a test or alter an expectation merely to make it pass. Update an expectation only when the requirement deliberately changed, and add coverage for the required behavior.
4. Work strictly in wave order. Do not start a later wave while an earlier wave has unresolved Critical or Important findings.
5. Treat browser input, browser state, LLM output, declared MIME types, browser `postMessage` events, and session UUIDs as untrusted. Server-side, durable evidence is authoritative.
6. Before returning a successful UI response or writing a user-visible team message, verify the underlying state change or external delivery succeeded durably.
7. Preserve response compatibility only where there is a concrete client consumer. Do not retain unsafe behavior for compatibility.
8. Use subagents only for independent investigations or non-overlapping edit areas.
9. After each wave, run focused tests and report changed files, tests run, and remaining risks. Do not claim a wave complete without its acceptance evidence.
10. At the end, run every command in the Final Verification section. If any fails, report the exact failure and continue fixing it.

## Release Invariants

The completed implementation must satisfy all of these invariants:

- Failed persistence, failed relay, failed scheduling verification, and failed Telegram delivery never appear as approval, delivery, or team-notification success.
- A Telegram update cannot appear as a team message unless its secret, chat, and sender configuration are all present and verified.
- Every accepted attachment has passed server-side content validation; detected MIME is authoritative; unverified content is never forwarded.
- Separate analysis and producer-transfer consent are stored and verified server-side. Neither browser fields nor LLM tool calls can create them.
- Corrections, reset, deletion request, and session capability lifecycle are canonical server-side actions, not optimistic widget-only state.
- Handoff dispatch is crash-recoverable, cannot double-send a claim, and has a documented authenticated scheduler invocation.
- Event ingestion is authenticated and allowlisted. Observability is wired into production flows without logging PII, message text, URLs, file contents, credentials, capabilities, or signed URLs.
- CI runs the stated release gates, and production-mode desktop/mobile E2E tests pass.

## Wave 1: Close Critical Trust and Truthfulness Failures

Implement these together because they affect security boundaries and user-visible claims.

### 1. Finalization persistence must fail closed

Files to inspect/fix:

- `app/api/leads/finalize/route.ts`
- `components/widget/widget-overlay.tsx`
- `components/widget/review-panel.tsx`
- `tests/api/leads-finalize.test.ts`
- relevant widget tests

Requirements:

- If updating consent/session state or inserting the lead fails, return `ok: false` with a non-2xx status and do not continue to topic creation, outbox enqueueing, or a success response.
- Do not mark the brief approved unless `ok === true` and `persisted === true`.
- Ensure the UI shows a retryable error rather than "approved", "saved", or "ready for the team" after a failed server persistence operation.
- Preserve truthful queued/delivered/retryable states after successful persistence.
- Add API persistence-failure and widget regression tests.

### 2. Fail closed on Telegram sender configuration

Files to inspect/fix:

- `app/api/telegram/webhook/route.ts`
- `lib/telegram/webhook-auth.ts`
- `.env.example`
- `tests/api/telegram-webhook.test.ts`

Requirements:

- In production, a missing or empty `TELEGRAM_ALLOWED_USER_IDS` configuration must return a safe configuration failure before any database side effect.
- Missing sender username, wrong sender, wrong chat, and invalid secret must all be rejected before replay persistence, session lookup, schedule/file-request actions, or team-message insertion.
- Keep explicitly configured non-production test behavior only where needed to test routes; do not preserve production fail-open semantics.
- Add regression coverage for absent sender configuration and wrong sender. Replace any test that asserts the unsafe missing-allowlist behavior.

### 3. Reject unverifiable attachment contents

Files to inspect/fix:

- `app/api/telegram/upload/route.ts`
- `lib/uploads/quarantine.ts`
- `lib/uploads/file-policy.ts`
- `tests/api/telegram-upload.test.ts`
- `tests/uploads/quarantine.test.ts`

Requirements:

- Reject every file for which `validateFile()` returns `ok: false`; do not exempt the "Could not verify file type" failure.
- Validate complete signatures, including RIFF WebP's `WEBP` subtype at bytes 8-11.
- Use `validateFile()`'s detected MIME for persistence and Telegram metadata. Do not trust `file.type`.
- Either add secure detection for each accepted binary format or reduce the upload allowlist to formats that can be validated safely. Do not accept by extension alone.
- Add malicious renamed payload, malformed RIFF, detected-MIME persistence, and approved-transfer forwarding tests.

### 4. Stop treating Calendly browser events as booking evidence

Files to inspect/fix:

- `components/chat/calendly-embed.tsx`
- `components/widget/widget-overlay.tsx`
- `app/api/telegram/schedule-complete/route.ts`
- `lib/api/client.ts`
- relevant API/widget tests

Requirements:

- A browser `calendly.event_scheduled` message is a UI hint only. It may update local presentation but must not send Telegram, clear `schedule_request_open`, or insert a `sender: 'team'` message.
- Validate both Calendly message origin and message source against the embedded frame before accepting the UI hint.
- Introduce a secure server-side booking verification mechanism (provider webhook/API verification with a configured secret and documented configuration), or keep the endpoint fail-safe until verified evidence exists.
- Only verified server-side booking evidence may clear the request, notify Telegram, and persist a team-visible booking confirmation.
- A caller with a valid session capability but no booking evidence must receive no success state and cause no side effect.
- Add direct-route-forgery, invalid-origin/source, verified-booking, persistence-failure, and Telegram-failure tests.

Wave 1 acceptance:

- Failed lead persistence, forged schedule completion, unconfigured Telegram sender identity, and spoofed file content all fail safely with no misleading UI/team message.

## Wave 2: Make Consent, Project State, and Attachment Data Canonical

### 1. Enforce notice and transfer consent on the server

Files to inspect/fix:

- `lib/api/contracts.ts`
- `app/api/sessions/route.ts`
- `app/api/chat/route.ts`
- `app/api/telegram/upload/route.ts`
- `app/api/attachments/link/route.ts`
- `app/api/leads/finalize/route.ts`
- `lib/uploads/consent.ts`
- relevant API tests

Requirements:

- Session creation must require the notice/consent transition before persisting session metadata. Validate a supported consent version and timestamp server-side.
- Do not persist raw source/referrer URL detail beyond the approved minimized representation.
- Persist separate analysis consent and producer-share/producer-transfer consent as authoritative server state, with timestamp/version/provenance.
- Upload and link routes must load that server state after session authentication. They must ignore submitted consent JSON except, if necessary, as a request to a dedicated authenticated consent-transition endpoint.
- Finalization must require recorded explicit send/producer-transfer consent and derive packet consent scope from persisted state. Never set it to a hard-coded value.
- Add forgery tests proving a capability holder cannot supply `producerShare: true` in a request to bypass consent.

### 2. Wire corrections, reset, and deletion into the widget

Files to inspect/fix:

- `components/widget/widget-overlay.tsx`
- `components/widget/review-panel.tsx`
- `lib/api/client.ts`
- `app/api/projects/[sessionId]/draft/route.ts`
- `app/api/projects/[sessionId]/delete/route.ts`
- `app/api/chat/route.ts`
- relevant widget/API/E2E tests

Requirements:

- Load and persist review edits through the authenticated canonical draft endpoint.
- Add version-aware conflict protection. Do not silently overwrite a newer draft.
- Replace widget-only reset with an authenticated server reset that clears canonical draft data and revokes or rotates the session capability. Clear the cookie/session client state only after that server action succeeds.
- Do not say memory was cleared until the server confirms it.
- Expose a user-accessible deletion-request action that calls the existing authenticated route and reports the durable request status truthfully.
- Add widget-to-route tests for edit persistence across reload, reset/reload behavior, capability invalidation/rotation, and deletion-request submission.

### 3. Align attachment storage, packet, and operator schema

Files to inspect/fix:

- `supabase/migrations/*uploaded_files*.sql`
- `app/api/telegram/upload/route.ts`
- `app/api/leads/finalize/route.ts`
- `app/api/internal/uploads/route.ts`
- `lib/handoff/packet.ts`
- integration and API tests

Requirements:

- Choose one actual uploaded-file metadata model and migrate it safely. Do not query columns that the migrations do not create.
- Include attachment status, detected MIME, and a user-safe name in handoff packets based on that model.
- Make the internal uploads route query the same model; do not sign null/nonexistent storage paths.
- Add migration-backed integration coverage proving upload persistence, packet inclusion, and operator retrieval agree.

Wave 2 acceptance:

- Consent cannot be forged by browser/LLM input; canonical edits/reset/deletion survive or reconcile on reload; attachment data is consistently represented across upload, handoff, and operations.

## Wave 3: Durable Delivery, Authenticated Events, and Operational Readiness

### 1. Recoverable atomic outbox and scheduler

Files to inspect/fix:

- `lib/handoff/outbox.ts`
- `supabase/migrations/015_trust_delivery_outbox.sql` or a new forward-only migration
- `app/api/internal/handoff-dispatch/route.ts`
- platform scheduler configuration and operations documentation
- `tests/handoff/outbox.test.ts`
- scheduler/dispatch integration tests

Requirements:

- Replace the permanent `claiming` state with an atomic claim plus lease expiry/recovery strategy. A process crash must return expired claims to the retry path without allowing concurrent double-send.
- Ensure delivery state changes are conditional on the owning claim/lease.
- Add an authenticated scheduled invocation mechanism for dispatch. Document the URL, secret, cadence, retries, and alert/escalation procedure.
- Test concurrent claims, crash/expired-lease recovery, Telegram failure, retry/backoff, escalation, and scheduled invocation authentication.
- Do not use a destructive schema reset; add a forward-only migration for deployed databases.

### 2. Secure and wire event ingestion and metrics

Files to inspect/fix:

- `app/api/events/route.ts`
- `lib/observability/events.ts`
- `lib/logger.ts`
- mutation routes under `app/api/`
- `tests/observability/*`
- `tests/api/events-route.test.ts`

Requirements:

- Make `/api/events` capability-authenticated and origin-protected, or make it private/server-only. Allowlist event names and fields; reject unknown names.
- Thread request IDs through routes and event/log records.
- Wire the versioned event emitter into real flows for consent, correction, reset/deletion, delivery, escalation reason, producer response time, and LLM fallback. Unit tests alone are insufficient.
- Never log PII, message text, URLs, file content, credentials, raw capabilities, signed URLs, or secret values. Review existing error logging as part of this work.
- Add `docs/trust-metrics.md` and `docs/producer-review-runbook.md` with metric definitions, retention/ownership, alert thresholds, and operator response procedures.

Wave 3 acceptance:

- A crashed dispatcher cannot strand an approval forever; an attacker cannot forge analytics events; trust metrics exist in real production flows without leaking sensitive data.

## Wave 4: Complete CI, E2E, Mobile, and Accessibility Gates

Files to inspect/fix:

- `tests/e2e/intake.spec.ts`
- `tests/e2e/mobile-intake.spec.ts` (create if missing)
- `playwright.config.ts`
- `.github/workflows/ci.yml`
- widget modal/upload/tab components and tests
- Calendly configuration consumers

Requirements:

- Update intake E2E tests to explicitly acknowledge the notice and choose the correct start path before asserting chat input. Do not remove the notice gate to satisfy tests.
- Run Playwright against a production build/start command, not `next dev`.
- Add a mobile Playwright project and coverage for the notice gate, intake, brief tabs/layout, keyboard upload, and 320px Calendly rendering.
- Ensure CI fails on dependency audit findings at the defined severity; remove `|| true` unless an explicit documented exception is approved.
- Add CI gates for migration integration, webhook authorization, session authorization, accessibility/mobile E2E, and dependency failures. A named job is not sufficient unless it executes the corresponding tests.
- Complete modal semantics and keyboard behavior: `aria-modal`, focus entry/trap/restore on every modal including mobile/upload policy, keyboard-operable upload controls, and ARIA tab keyboard navigation.
- Validate a single configured Calendly URL before iframe/initializer use and use consistent duration copy everywhere.

Wave 4 acceptance:

- `npm run test:e2e` passes locally with desktop and mobile coverage.
- CI uses production-mode E2E and enforces every named release gate.
- All modal, tab, upload, and 320px calendar requirements have automated evidence.

## Final Verification

Run all commands and report their exact result summaries:

```powershell
npm run lint
npx tsc --noEmit
npm run build
npx vitest run
npm run test:e2e
```

Before handing the work back, perform a final read-only review against:

- `docs/plans/2026-07-11-trust-first-remediation.md`
- `docs/plans/2026-07-12-remediation-execution-orchestrator.md`
- this prompt

Report:

1. Changed files grouped by wave.
2. Each review finding and the regression test or other evidence that proves it resolved.
3. Each release invariant and the implementation evidence.
4. Exact verification results.
5. Any remaining risks or intentionally deferred work.

Do not merge, push, commit, or create a pull request.
