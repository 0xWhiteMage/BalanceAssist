# Supabase-Managed CRM Migrations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run the reviewed Monday CRM migration transaction through Supabase Management API instead of a direct PostgreSQL connection from GitHub Actions.

**Architecture:** Retain the checked-in `production-monday-crm-044-053.sql` artifact as the only production-changing input. The protected workflow validates the immutable `main` commit, verifies the reviewed source hashes with the existing runner's dry run, links the configured Supabase project ephemerally, and submits the artifact as one `supabase db query --linked` request.

**Tech Stack:** GitHub Actions, Supabase CLI 2.x, Supabase Management API, PostgreSQL, Node.js, Vitest.

---

### Task 1: Test The Managed-API Release Contract

**Files:**
- Modify: `tests/integration/production-crm-migration-policy.test.ts`
- Modify: `tests/integration/monday-release-proof.test.ts`
- Modify: `.github/workflows/production-crm-migrations.yml`

**Step 1: Write failing workflow assertions**

Add assertions that the protected CRM workflow:

```ts
expect(workflow).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}');
expect(workflow).toContain('npx supabase db query --linked --file supabase/production-monday-crm-044-053.sql');
expect(workflow).not.toContain('PRODUCTION_DATABASE_URL');
expect(workflow).not.toContain('apply-production-crm-migrations.mjs\n');
```

Keep the existing assertions for the `main`-trusted workflow reference and the protected `production-crm-migrations` environment.

**Step 2: Run the focused tests and verify they fail**

Run:

```powershell
npx vitest run tests/integration/production-crm-migration-policy.test.ts tests/integration/monday-release-proof.test.ts
```

Expected: FAIL because the workflow still injects `PRODUCTION_DATABASE_URL` and runs the direct PostgreSQL runner.

**Step 3: Commit the failing-test checkpoint only if working in a reviewable TDD branch**

Do not commit a known failing release workflow to `main`; keep the test and implementation changes together if the branch is shared.

### Task 2: Switch The Protected Workflow To Supabase Management API

**Files:**
- Modify: `.github/workflows/production-crm-migrations.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/monday-crm-runbook.md`

**Step 1: Replace direct database credentials in the migration job**

Use only the protected environment's Supabase access token:

```yaml
env:
  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

Remove `PRODUCTION_DATABASE_URL` from this workflow only. Leave the direct runner source intact for local policy checks and existing tests; it is no longer the production transport.

**Step 2: Add ephemeral project linking and artifact execution**

Replace the direct execution block with:

```bash
set -euo pipefail
test -n "$SUPABASE_ACCESS_TOKEN"
node scripts/apply-production-crm-migrations.mjs --dry-run
mkdir -p supabase/.temp
printf '%s' 'vbdqjgwcmckutwehrbvo' > supabase/.temp/project-ref
npx supabase db query --linked --file supabase/production-monday-crm-044-053.sql
```

The project ref is public infrastructure metadata and must match the production project verified during release. Do not place the access token, database password, or connection URI in repository files or logs.

**Step 3: Document the new credential boundary**

Update `.env.example`, `README.md`, and `docs/monday-crm-runbook.md` to state:

- `SUPABASE_ACCESS_TOKEN` belongs only in the `production-crm-migrations` GitHub environment;
- `PRODUCTION_DATABASE_URL` is not used by the CRM migration workflow;
- the CRM artifact is applied through Supabase Management API;
- the canary retains its own database verification prerequisite until it has been migrated separately.

**Step 4: Run focused tests and verify they pass**

Run:

```powershell
npx vitest run tests/integration/production-crm-migration-policy.test.ts tests/integration/monday-release-proof.test.ts
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add .github/workflows/production-crm-migrations.yml .env.example README.md docs/monday-crm-runbook.md tests/integration/production-crm-migration-policy.test.ts tests/integration/monday-release-proof.test.ts
git commit -m "fix: run CRM migrations through Supabase"
```

### Task 3: Verify The Whole Release Contract

**Files:**
- Verify only: `scripts/apply-production-crm-migrations.mjs`
- Verify only: `supabase/production-monday-crm-044-053.sql`
- Verify only: `.github/workflows/monday-canary.yml`

**Step 1: Verify source and artifact integrity locally**

Run:

```powershell
node scripts/apply-production-crm-migrations.mjs --dry-run
```

Expected: JSON plan containing only `044`, `047`, `048`, `049`, `052`, and `053`, with schema version `053`.

**Step 2: Verify Supabase Management API access with a read-only query**

With `SUPABASE_ACCESS_TOKEN` configured locally and `supabase/.temp/project-ref` containing the production ref, run:

```powershell
npx supabase db query --linked "select current_database() as database, current_user as user" --output json
```

Expected: `postgres` database and `postgres` user. Do not print any credentials.

**Step 3: Run the full suite**

Run:

```powershell
npm test
```

Expected: all enabled tests pass; prerequisite-gated integration tests may remain skipped.

**Step 4: Trigger and inspect the protected workflow after merge**

Run:

```powershell
gh workflow run "Production CRM migrations" --ref main --field ref=<merged-commit-sha>
gh run watch <run-id> --exit-status
```

Expected: successful validation and migration jobs. Only after this succeeds, trigger the dormant-lane Monday canary.
