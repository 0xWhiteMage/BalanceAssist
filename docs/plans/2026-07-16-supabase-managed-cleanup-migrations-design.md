# Supabase-Managed Cleanup Migration Design

## Goal

Safely establish production baseline `043` by applying the reviewed cleanup
migration range `038` through `043` through Supabase, so the blocked Monday
CRM migration can proceed.

## Decision

Create a reviewed SQL Editor recovery artifact for migrations `038` through
`043` and move the protected cleanup workflow to the same pinned Supabase CLI
Management API transport used by CRM migrations.

The artifact will run one transaction that takes the shared advisory lock,
requires recorded baseline `037_scheduler_health.sql`, confirms the cleanup
range is empty, applies only the reviewed sources, records every migration,
verifies the six records, and commits. It is an emergency SQL Editor fallback;
the protected workflow remains the preferred execution path.

## Workflow

1. The dispatch-only trusted-main workflow preserves its immutable commit,
   backup-audit, and protected-environment gates.
2. It verifies source hashes and the exact generated artifact before any
   database-changing request.
3. It uses the lockfile-pinned CLI to link the production project with only
   `SUPABASE_ACCESS_TOKEN`, then submits the artifact with `db query --linked`.
4. The existing post-migration production health smoke remains required.

## Backup Gate

The cleanup chain changes deletion behavior and must not run without a fresh
backup attestation. The workflow continues to require:

`BACKUP_AUDIT:<UTC timestamp>|<provider>|<backup ID>|<40-character release SHA>`

The timestamp must be no more than 24 hours old and the release SHA must match
the immutable workflow input. No placeholder attestation is valid.

## Validation

- Unit tests verify the exact cleanup allowlist, artifact hash, trusted workflow
  protections, token-only Supabase CLI transport, backup gate, and SQL Editor
  artifact guards.
- A read-only Supabase query confirms production currently records baseline
  `037` and no cleanup or CRM migration versions.
- Full tests must pass before merge.
