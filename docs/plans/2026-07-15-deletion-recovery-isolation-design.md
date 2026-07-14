# Deletion Recovery Isolation Design

## Scope

Associate private attachment recovery rows with a random opaque cleanup-owner UUID per session. The deletion request copies that owner into the durable deletion job. This is internal lifecycle metadata only: it neither contains PII nor derives or exposes storage object keys.

## Data Flow

The migration adds nullable `cleanup_owner_id` ownership to `private_attachment_cleanup`, a distinct randomly generated owner to each session, and copies that owner into deletion jobs. New recovery rows resolve their owner server-side from the session. The migration backfills only rows whose opaque object key can be matched to a current session upload. Rows that cannot be proven to belong to a session remain unowned and are deferred to the existing retention cleanup flow.

The deletion worker filters recovery rows by both its claimed job owner and configured bucket. The orphaned-job completion function likewise considers only cleanup rows owned by its job, so another session's recovery state cannot block or be deleted by that worker.

## Tests

Regression tests verify worker query ownership and migration policy. The database integration test creates two deletion jobs and recovery rows, then proves the claimed job can complete without deleting or waiting on the unrelated job's recovery record.
