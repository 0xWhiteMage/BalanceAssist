# Release Hardening Design

**Date:** 2026-07-13

**Status:** Approved

## Objective

Make Balance Assist safe and truthful for a live-data deployment by correcting the confirmed security, consistency, delivery, desktop/mobile UX, accessibility, and release-proof gaps without a high-risk rewrite.

## Context

Seven independent expert reviews examined product scope, security/privacy, backend reliability, desktop UI/UX, mobile UI/UX, QA/release gates, and code hygiene at `a5799b2`. The reviews converged on release-blocking defects despite 662 passing unit tests and four passing mocked browser tests.

The Supabase database is already deployed with live user data. All database changes must therefore be forward-only and non-destructive. Features that cannot yet make truthful claims will be gated case by case rather than silently losing data or reporting success.

## Principles

- Treat browser input, capabilities, source URLs, LLM output, filenames, and external callbacks as untrusted.
- Require durable server evidence before claiming saved, approved, shared, delivered, connected, booked, reset, or deleted.
- Keep public error responses stable and nonsensitive; retain only allowlisted, recursively sanitized diagnostics.
- Prefer one authoritative implementation over test-only abstractions or duplicated client/server contracts.
- Use additive migrations and compare-and-swap or transactional database operations for canonical state.
- Refactor only where duplicated ownership is causing defects; do not perform a wholesale rewrite.
- Prove behavior at real boundaries, not solely with mocks.

## Architecture And Work Waves

### Wave 0: Evidence And Deployment Baseline

Capture the expected deployed schema, inventory every public table and route, and add failing boundary tests for confirmed defects before changing behavior. Establish a disposable PostgreSQL/Supabase-compatible migration test path and document production backup and dry-run requirements.

### Wave 1: Trust Boundary

- Generate one session UUID and use it for the database row, capability, cookie, and response.
- Fail session creation closed when durable persistence is unavailable.
- Require a persisted authenticated session and trusted origin for provider-backed chat.
- Apply distributed abuse controls to session creation and chat; enforce body limits before provider calls.
- Add deny-by-default RLS and grant tightening for all public tables while preserving server service-role access.
- Replace self-authorizing attachment requests with a separate authenticated consent transition.
- Recompute qualification and routing inputs from canonical server state.
- Consolidate logging and event sanitization around strict allowlists and stable error codes.

### Wave 2: Consistency And Delivery

- Route every canonical draft writer through one atomic compare-and-swap operation.
- Return canonical draft/version after chat persistence and expose real conflicts as `409`.
- Make finalization transactionally idempotent with a stable key and one lead/outbox result.
- Add claim ownership to outbox leases and condition terminal updates on the current owner.
- Make Telegram webhook replay processing resumable rather than permanently consuming failed updates.
- Persist relay/upload intent before external sends and report separate persistence, queued, delivered, and failed outcomes.
- Store analysis-only uploads in private durable quarantine or disable that upload path until storage is configured.
- Implement durable deletion processing, retention policy, and completion status.
- Align retry timings, cron capacity, timeouts, and operational metrics with serverless cadence.

### Wave 3: Product And UI State

- Replace optimistic booleans with explicit states for session, approval, relay, upload, and scheduling.
- Keep approval retryable and distinguish brief persistence from producer delivery.
- Use requested, sending, delivered, replied, and failed human-handoff states; show connected only after a real human response.
- Route every file selection through one consented uploader and remove the legacy local-only attachment path.
- Treat Calendly browser events as hints only; signed provider evidence is authoritative.
- Make reset and deletion discoverable, confirmed actions with durable outcomes.
- Split cohesive session/draft, conversation, and team-polling controllers from `WidgetOverlay` to remove duplicated state ownership.
- Preserve the existing Balance visual language while improving hierarchy, legibility, truthful copy, and recovery.

### Wave 4: Accessibility, Mobile, QA, And Reduction

- Use one dialog contract at every viewport: focus entry, containment, Escape, restoration, nested modal isolation, and live announcements.
- Make uploads keyboard-operable; use 44px mobile targets and 16px mobile inputs.
- Support dynamic viewport height, safe areas, software keyboards, constrained popovers, and scroll containment.
- Test 320px, 375px, 390px, and 412px layouts plus desktop zoom/reflow and WebKit.
- Execute the complete migration chain and representative queries in CI.
- Add at least one browser journey through real application routes and a disposable database, with controlled external-service HTTP stubs.
- Remove dead test-only trust/metrics modules, unused clients/configuration, duplicate contracts, and stale documentation.

## Product Rules

### Sessions And Chat

A failed session insert returns a retryable unavailable response and does not issue a synthetic capability. Careers intent is handled deterministically before LLM invocation. Provider-backed chat requires a persisted authenticated session. Static scope/help responses may remain local when they do not transmit user data.

### Consent And Attachments

Analysis consent and producer-transfer consent are separate, authenticated, durable transitions with version, time, and provenance. Upload, link, and finalization routes ignore submitted consent claims and read prior server state. Analysis-only bytes must be retrievable from private quarantine before the UI says they are retained; otherwise file upload is unavailable and reference links remain the supported path.

### Approval And Delivery

The UI distinguishes brief saved, handoff queued, handoff delivered, and handoff failed. Approval failures always permit retry. A real human reply establishes team connection; mode switches do not. External send acceptance without durable reply mapping is not complete delivery.

### Scheduling

Calendly `postMessage` events may update local presentation only after origin and source validation. They never clear server state or notify the team. Until a signed provider webhook is configured and verified, the UI says booking verification is pending.

### Data Controls

Reset and deletion are visible controls with confirmation. Reset completion requires canonical state clearing and capability rotation/revocation. Deletion requests enter a durable queue with status and SLA; retention, backups, storage objects, and downstream Telegram limitations are documented.

## API And Error Contract

- `400` for invalid input with a stable public code.
- `401` or `403` for authentication, capability, origin, or scope failure.
- `409` for canonical version conflicts or unverified completion state.
- `413` for transport or file size limits.
- `429` for enforced abuse limits.
- `502` for checked upstream rejection and `503` for unavailable required infrastructure.
- Idempotent retries return the existing canonical operation result.
- Raw database, provider, token, URL, message, filename, and capability values never enter responses or logs.

## Verification Strategy

Every behavior correction follows red-green-refactor TDD. Existing mocked tests remain as fast component/contract coverage, but they are supplemented with:

- An executable fresh-schema and upgrade-path migration test.
- RLS/grant assertions for every exposed table.
- Real database tests for session capability identity, CAS, finalization idempotency, outbox ownership, replay recovery, retention, and deletion.
- A browser journey through real app routes and the test database.
- Controlled HTTP stubs for Telegram, LLM, and Calendly boundaries.
- Desktop Chromium, mobile Chromium, and mobile WebKit coverage with traces and screenshots retained on failure.
- Accessibility tests for focus, modal containment, tabs, uploads, status announcements, reduced motion, and failure recovery.
- Dependency, secret, artifact, and diff hygiene scans.

Each wave receives a focused independent expert re-review. Final verification includes lint, typecheck, production build, unit/integration tests, migration tests, desktop/mobile E2E, audit, and `git diff --check`.

## Live Rollout

1. Capture a database backup and deployed schema/grant inventory.
2. Apply migrations to a production-shaped copy and run representative route queries.
3. Deploy additive schema and policy changes with service-role smoke tests.
4. Deploy the application and run persisted-session, capability, handoff, and deletion smoke checks.
5. Monitor authentication failures, oldest pending handoff, duplicate attempts, upload quarantine failures, and deletion backlog.
6. Roll back application behavior through feature gates when needed; do not destructively roll back forward schema migrations.

No live migration, deployment, merge, or push is part of implementation without separate explicit approval.

## Success Criteria

- No unauthenticated or unconsented request reaches a paid model or durable user-data path.
- Public database access is deny-by-default and verified against the deployed schema model.
- Canonical writes do not silently overwrite or report unpersisted state.
- Lead, relay, upload, webhook, and outbox retries do not create avoidable duplicates or permanent loss.
- Every user-visible success statement corresponds to durable evidence.
- Core desktop and mobile journeys remain usable by keyboard, screen reader, touch, and narrow/short viewports.
- CI exercises migrations and at least one real critical journey rather than relying solely on mocks.
- Dead and duplicate enforcement code is removed after authoritative paths replace it.
