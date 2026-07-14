# Release Hardening Design

## Decision

Production releases are manual GitHub Actions dispatches to a protected `production` environment. The release workflow checks out the requested commit, runs all release gates, deploys that commit to an immutable Vercel URL, smokes the immutable deployment, requires an approved production migration workflow to have recorded the same commit's schema version, then promotes the immutable deployment to the production alias and configures Telegram.

## Boundaries

Vercel must have Git-based production deployments disabled in its dashboard so GitHub Actions is the sole production deployment path. The workflow uses Vercel CLI tokens held only in protected GitHub environments. Production migration credentials are held only by the protected migration workflow and are never placed in repository configuration.

## Scheduler Health

Existing five-minute GitHub schedules remain. Each authenticated worker posts a heartbeat after its work succeeds. An authenticated scheduler-health route reports stale worker heartbeats, old pending outbox entries, and expired-session backlog. A separate five-minute monitor calls it and fails alert-ready when unhealthy, while documentation accounts for scheduler delay and GitHub inactivity disablement.

## Validation

Node-environment Vitest tests parse workflow YAML and assert trigger, dependency, secret, protected-environment, ordering, and fail-closed contracts. Tests do not invoke Vercel, GitHub, Telegram, or production databases.
