# Durable Deletion Processing Design

## Decision

Replace the deletion-request event with one durable, opaque deletion job per session. The user-facing route creates or returns that canonical job and reports only its actual state. A GitHub Actions worker runs on the existing five-minute cadence, claims jobs with a lease token, removes private storage objects and recovery obligations first, and only then removes the session in a database transaction so existing foreign-key cascades delete owned rows.

## Alternatives Considered

1. Keep event-only requests and let expiry clean data later. This is not observable, cannot be retried independently, and cannot truthfully report completion.
2. Delete synchronously in the authenticated route. This risks request timeouts and partial private-storage cleanup, and gives no durable retry state.
3. Use a durable leased job and a separate worker. This supports safe retries, claim ownership, truthful status, and fail-safe object-first cleanup. This is the selected approach.

## Data And Processing

`deletion_jobs` contains an opaque UUID job ID, its session reference, state, attempt count, lease token and expiry, and lifecycle timestamps. It deliberately contains no draft, contact, object-key, error text, request headers, or other PII. A partial unique index permits one active job per session while retaining completed job status.

The worker claims one requested, failed, or expired-lease job atomically. It discovers the session's stored-file metadata and any cleanup obligations, removes each private object first, then removes the corresponding metadata or recovery row. Any cleanup failure leaves the job retryable and does not delete the session. Once the cleanup set is empty, a token-checked database function deletes the session; existing cascade constraints remove owned relational rows. The job is then marked completed without retaining deleted data.

## Scheduling And Operations

GitHub Actions, not Vercel cron, invokes the internal deletion worker every five minutes and records its heartbeat. Scheduler health includes the worker and flags an overdue active deletion job. The privacy notice and runbook state a 24-hour deletion SLA, job-status behavior, the private-storage scope, and the limits for backups and previously transferred Telegram content.

## Validation

Tests cover route authentication and idempotency, lease ownership and retry transitions, object-first cleanup and failure deferral, session cascade deletion, PII-free job records and logs, plus GitHub scheduler and health contracts. Database tests may be skipped when the local Supabase Docker stack is unavailable.
