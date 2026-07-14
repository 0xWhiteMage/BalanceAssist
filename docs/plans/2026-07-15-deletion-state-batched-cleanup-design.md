# Deletion State Batched Cleanup Design

## Goal

Prevent a private upload from escaping a deletion job's cleanup obligations and
drain every attachment record before deleting its session.

## Design

`sessions` gains a database-owned deletion state. A security-definer RPC
reserves an opaque recovery record only while the session is active, so a
deletion request makes later upload attempts fail before object creation. The
same database transition claims the session for deletion before the worker
starts external cleanup.

The deletion worker uses bounded, keyset-paginated queries for stored metadata
and recovery records. It deletes each storage object and its obligation before
advancing. Database functions refuse session deletion and job completion while
either stored metadata or owned recovery obligations remain. Any database or
storage uncertainty defers the job rather than deleting the session.

## Tests

Tests prove that upload reservation fails after deletion begins, that all 1,001
rows are cleaned across pages, and that deletion does not complete until the
database reports all cleanup obligations drained.
