# Release Proof Boundaries Design

## Decision

Keep fast handler integration tests, but add a separate Node-driven HTTP journey against the production Next server in CI. The journey uses disposable PostgreSQL and a local fake Telegram HTTP server.

## Boundaries

Production Telegram functions retain the fixed Telegram API origin. Tests install a scoped transport override in process memory, so no runtime environment value can redirect production bot traffic. The fake records topic creation, message sends, and both document-send paths; production finalization creates its own topic rather than test code pre-seeding one.

## Hermeticity

Each journey creates a unique trusted client identity and Telegram update ID. Teardown removes its session-owned rows plus the matching API rate-limit and replay rows. CI starts the HTTP journey only after migrations and terminates its server process in all outcomes.
