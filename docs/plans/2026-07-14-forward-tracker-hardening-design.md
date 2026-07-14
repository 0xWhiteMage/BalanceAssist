# Forward Tracker Hardening Design

## Problem

Migration `018_public_schema_rls.sql` was changed to create and harden
`public.schema_migrations`. Databases that already recorded version `018` skip
that file, so they retain an unhardened tracker.

## Decision

Add a new migration after `034` that idempotently creates the tracker, enables
RLS, revokes `PUBLIC` access, and conditionally revokes `anon` and
`authenticated`. Preserve the runner's bootstrap table creation and its
Supabase CLI migration-history reconciliation.

## Verification

Source tests will require the new migration and inventory entry. A
`TEST_DATABASE_URL`-gated upgrade test will apply through `018`, then apply
the remaining chain and assert that the tracker has RLS and no direct browser
or public privileges.
