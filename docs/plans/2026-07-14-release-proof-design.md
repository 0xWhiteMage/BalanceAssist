# Release Proof Design

## Decision

Use the existing GitHub Actions PostgreSQL service, migration runner, and database-test job. Add one TEST_DATABASE_URL-gated integration journey that invokes production route handlers against PostgreSQL. A local fake Telegram HTTP boundary is the only networked external-service replacement.

## Journey

The test creates a persisted session and capability, records producer-transfer consent, updates the canonical draft, finalizes the producer transfer into the handoff outbox, dispatches it with authenticated internal credentials, accepts a signed Telegram webhook reply, and polls the persisted reply through its public route.

## CI Evidence

CI applies the whole incremental migration chain before database integration tests. Playwright retains production-mode startup and gains retry, trace, screenshot, report, and artifact settings. Its existing force click is removed. Documentation specifies the disposable database and release evidence commands.
