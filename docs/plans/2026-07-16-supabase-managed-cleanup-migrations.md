# Supabase-Managed Cleanup Migrations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply reviewed cleanup migrations `038` through `043` through Supabase Management API and provide an equivalent guarded SQL Editor artifact.

**Architecture:** A checked-in SQL artifact combines only the reviewed cleanup sources in one transaction, with a baseline-037 guard, advisory lock, migration-range guard, records, and verification. The protected workflow verifies both source and artifact hashes, then uses the lockfile-pinned Supabase CLI to link the production project and submit that artifact through Management API after a fresh backup attestation.

**Tech Stack:** PostgreSQL, Supabase CLI 2.109.1, Supabase Management API, GitHub Actions, Node.js, Vitest.

---

### Task 1: Create The Reviewed Cleanup SQL Editor Artifact

**Files:**
- Create: `supabase/production-cleanup-038-043.sql`
- Modify: `scripts/apply-production-cleanup-migrations.mjs`
- Modify: `tests/integration/production-cleanup-migration-policy.test.ts`

**Step 1: Write failing artifact-integrity tests**

Test that the artifact LF-normalizes and contains exactly the source of each:

```ts
['038_durable_deletion_jobs.sql', '039_deletion_scheduler_health.sql',
 '040_deletion_recovery_lifecycle.sql', '041_deletion_backlog_count.sql',
 '042_deletion_recovery_ownership.sql', '043_deletion_state_batched_cleanup.sql']
```

Assert it excludes `044_`, acquires the cleanup advisory lock, requires
baseline version `037_scheduler_health.sql`, rejects an already-recorded
cleanup version, inserts every cleanup migration record, verifies all six
records, and commits.

**Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx vitest run tests/integration/production-cleanup-migration-policy.test.ts
```

Expected: FAIL because no cleanup SQL Editor artifact exists.

**Step 3: Build the artifact**

Create one transaction with this outer structure:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(90442043);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '037' AND filename = '037_scheduler_health.sql') THEN
    RAISE EXCEPTION 'cleanup migration baseline 037 is not recorded with its reviewed filename';
  END IF;
  IF to_regclass('public.sessions') IS NULL OR to_regclass('public.private_attachment_cleanup') IS NULL OR to_regclass('public.scheduler_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'cleanup migration baseline schema signatures are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version IN ('038', '039', '040', '041', '042', '043')) THEN
    RAISE EXCEPTION 'reviewed cleanup migration range is not empty';
  END IF;
END $$;
```

Append each reviewed source exactly once in version order, followed by:

```sql
INSERT INTO public.schema_migrations (version, filename) VALUES
  ('038', '038_durable_deletion_jobs.sql'),
  ('039', '039_deletion_scheduler_health.sql'),
  ('040', '040_deletion_recovery_lifecycle.sql'),
  ('041', '041_deletion_backlog_count.sql'),
  ('042', '042_deletion_recovery_ownership.sql'),
  ('043', '043_deletion_state_batched_cleanup.sql');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.schema_migrations WHERE version IN ('038', '039', '040', '041', '042', '043')) <> 6 THEN
    RAISE EXCEPTION 'cleanup migration verification failed';
  END IF;
END $$;
COMMIT;
```

**Step 4: Add artifact-digest verification to the runner**

Hash the LF-normalized artifact against a reviewed SHA-256 in
`apply-production-cleanup-migrations.mjs` before either dry-run return or a
direct connection. Add a tampered-artifact test that appends SQL and expects
the runner to reject it.

**Step 5: Run focused test and verify it passes**

Run:

```powershell
npx vitest run tests/integration/production-cleanup-migration-policy.test.ts
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add supabase/production-cleanup-038-043.sql scripts/apply-production-cleanup-migrations.mjs tests/integration/production-cleanup-migration-policy.test.ts
git commit -m "feat: add reviewed cleanup SQL artifact"
```

### Task 2: Move The Cleanup Workflow To Supabase Management API

**Files:**
- Modify: `.github/workflows/production-cleanup-migrations.yml`
- Modify: `tests/integration/production-cleanup-migration-policy.test.ts`
- Modify: `README.md`
- Modify: `docs/deletion-processing-runbook.md`

**Step 1: Write failing workflow tests**

Require the cleanup workflow to:

- retain immutable-main validation, `production-cleanup-migrations` environment,
  backup-audit freshness/release-SHA checks, and health smoke;
- inject only `SUPABASE_ACCESS_TOKEN` for database access;
- use `npx --no-install supabase link --project-ref vbdqjgwcmckutwehrbvo --yes`;
- execute `npx --no-install supabase db query --linked --file supabase/production-cleanup-038-043.sql`;
- not contain `PRODUCTION_DATABASE_URL` or the direct cleanup runner apply command.

**Step 2: Run focused test and verify it fails**

Run:

```powershell
npx vitest run tests/integration/production-cleanup-migration-policy.test.ts
```

Expected: FAIL because the workflow still uses direct PostgreSQL credentials.

**Step 3: Implement the protected Management API transport**

Keep the backup attestation checks, then use:

```bash
test -n "$SUPABASE_ACCESS_TOKEN"
node scripts/apply-production-cleanup-migrations.mjs --dry-run
npx --no-install supabase link --project-ref vbdqjgwcmckutwehrbvo --yes
npx --no-install supabase db query --linked --file supabase/production-cleanup-038-043.sql
```

The artifact query is the only database-changing command. Keep the existing
post-migration production health smoke.

**Step 4: Document the manual fallback and backup gate**

Document `supabase/production-cleanup-038-043.sql` as the exact SQL Editor
fallback, emphasizing that it requires a verified fresh backup and the normal
protected workflow is preferred. Explain the attestation format without
including secrets.

**Step 5: Run focused tests and commit**

Run:

```powershell
npx vitest run tests/integration/production-cleanup-migration-policy.test.ts tests/integration/monday-release-proof.test.ts
```

Commit:

```powershell
git add .github/workflows/production-cleanup-migrations.yml README.md docs/deletion-processing-runbook.md tests/integration/production-cleanup-migration-policy.test.ts
git commit -m "fix: run cleanup migrations through Supabase"
```

### Task 3: Verify And Release In Order

**Files:**
- Verify only: `supabase/production-cleanup-038-043.sql`
- Verify only: `supabase/production-monday-crm-044-053.sql`

**Step 1: Verify local integrity and read-only production baseline**

Run:

```powershell
node scripts/apply-production-cleanup-migrations.mjs --dry-run
npx --no-install supabase db query --linked "select version::text, filename from public.schema_migrations where version::text in ('037','038','039','040','041','042','043','044','047','048','049','052','053') order by version" --output json
```

Expected before cleanup: only version `037` appears.

**Step 2: Run full tests**

Run:

```powershell
npm test
```

Expected: all enabled tests pass.

**Step 3: Obtain the required backup attestation**

Create or verify a fresh Supabase production backup. Use the actual backup
provider and identifier to construct:

```text
BACKUP_AUDIT:<UTC timestamp>|<provider>|<backup ID>|<merged cleanup commit SHA>
```

Never invent this value.

**Step 4: Execute releases in order**

1. Trigger `Production cleanup migrations` using the merged cleanup commit and
   verified backup attestation.
2. Confirm records `038` through `043` in `public.schema_migrations`.
3. Rerun `Production CRM migrations` for the merged CRM commit.
4. Confirm records `044`, `047`, `048`, `049`, `052`, and `053`.
5. Run the dormant-lane Monday canary.
