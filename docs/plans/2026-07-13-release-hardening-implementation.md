# Release Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct the confirmed release-blocking security, consistency, delivery, desktop/mobile UX, accessibility, and QA defects while preserving live data through forward-only migrations.

**Architecture:** Harden the existing application in deployable waves rather than rewriting it. Move canonical mutations into transactional PostgreSQL functions, keep route handlers as authenticated adapters, replace optimistic UI claims with explicit operation states, and prove critical behavior against an executable database and real application routes.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase/PostgreSQL, Zod, Vitest, Testing Library, Playwright, GitHub Actions.

---

## Operating Rules

- Work in `.worktrees/release-hardening` on `audit/release-hardening`.
- Use `@superpowers:test-driven-development` for every behavior change.
- Use forward-only migrations. Never edit an already deployed migration to change production behavior.
- Do not run migrations against the live database, deploy, merge, or push without explicit approval.
- After each task, use `@superpowers:requesting-code-review` and resolve Critical/Important findings before continuing.
- Keep public errors stable and nonsensitive. Never log message text, URLs, file contents, filenames, credentials, raw capabilities, signed URLs, or provider/database error text.

### Task 1: Execute The Migration Chain In CI

**Files:**
- Create: `scripts/apply-test-migrations.mjs`
- Create: `tests/integration/database-schema.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md:134-149`

**Step 1: Add the database test dependency and scripts**

Run:

```powershell
npm install --save-dev pg @types/pg
```

Add scripts:

```json
"test:db": "vitest run tests/integration/database-schema.test.ts",
"db:migrate:test": "node scripts/apply-test-migrations.mjs"
```

**Step 2: Write a failing executable schema test**

Use `TEST_DATABASE_URL` and `pg.Pool`. Assert migrations create the current tables and columns rather than searching SQL text:

```ts
const tables = await pool.query<{ table_name: string }>(`
  select table_name from information_schema.tables
  where table_schema = 'public'
`)

expect(tables.rows.map((row) => row.table_name)).toEqual(
  expect.arrayContaining([
    'sessions',
    'events',
    'leads',
    'human_messages',
    'uploaded_files',
    'reference_links',
    'handoff_outbox',
  ]),
)
```

Run:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/balance_assist_test'
npm run test:db
```

Expected: FAIL because no migration runner has prepared the database.

**Step 3: Implement the migration runner**

Read `supabase/migrations/*.sql` in lexical order, create `public.schema_migrations`, and execute each unapplied file inside a transaction. Reject duplicate migration numbers and never include `000_full_schema.sql` when applying the incremental chain.

Core transaction:

```js
await client.query('begin')
try {
  await client.query(sql)
  await client.query(
    'insert into public.schema_migrations (version, filename) values ($1, $2)',
    [version, filename],
  )
  await client.query('commit')
} catch (error) {
  await client.query('rollback')
  throw error
}
```

**Step 4: Add a PostgreSQL CI service**

Add a dedicated `database` job with a `postgres:16` service, health check, `TEST_DATABASE_URL`, migration execution, and `npm run test:db`. Make release/deployment jobs depend on it.

**Step 5: Correct database setup documentation**

Document the incremental chain through the newest migration, identify `000_full_schema.sql` as a legacy snapshot not to mix with the chain, and recommend the migration script rather than manual partial application.

**Step 6: Verify and commit**

Run:

```powershell
npm run lint
npx tsc --noEmit
npm run test:db
```

Expected: all pass against the disposable PostgreSQL database.

Commit:

```powershell
git add package.json package-lock.json scripts tests/integration .github/workflows/ci.yml README.md
git commit -m "test: execute database migrations in CI"
```

### Task 2: Fix Session Identity And Fail Closed

**Files:**
- Modify: `app/api/sessions/route.ts`
- Modify: `lib/api/client.ts`
- Modify: `tests/api/sessions-route.test.ts`
- Create: `tests/integration/session-capability.test.ts`
- Modify: `components/widget/widget-overlay.tsx`

**Step 1: Add failing route tests**

Assert the inserted row ID, capability-embedded ID, response ID, and cookie ID are identical. Add a persistence-failure test expecting `503`, no capability cookie, and `{ ok: false, code: 'session_unavailable' }`.

```ts
expect(insert).toHaveBeenCalledWith(
  expect.objectContaining({ id: returnedSessionId }),
)
expect(extractSessionIdFromCapability(cookieValue)).toBe(returnedSessionId)
```

Run:

```powershell
npx vitest run tests/api/sessions-route.test.ts
```

Expected: FAIL because the inserted ID differs and failures return a pseudo-session.

**Step 2: Use one generated ID**

Generate `sessionId` before the capability and include it in the insert:

```ts
const sessionId = crypto.randomUUID()
const { token, tokenHash, expiresAt } = generateCapability(sessionId)

const { error } = await supabase.from('sessions').insert({
  id: sessionId,
  session_capability_hash: tokenHash,
  session_capability_expires_at: expiresAt,
  // existing minimized metadata
})
```

If configuration or insertion fails, return `503` and do not set a cookie.

**Step 3: Make the widget recover honestly**

Keep the notice/intake screen active, display a retryable availability error, and never enter chat/human mode without `persisted: true`.

**Step 4: Add a real database integration assertion**

Create a session row with the production helper, then authenticate the returned capability against that row. Assert a mismatched UUID cannot authenticate.

**Step 5: Verify and commit**

Run:

```powershell
npx vitest run tests/api/sessions-route.test.ts tests/integration/session-capability.test.ts tests/widget/widget-overlay-session.test.tsx
```

Commit:

```powershell
git add app/api/sessions/route.ts lib/api/client.ts components/widget/widget-overlay.tsx tests
git commit -m "fix: issue capabilities for persisted sessions"
```

### Task 3: Deny Public Database Access By Default

**Files:**
- Create: `supabase/migrations/018_public_schema_rls.sql`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `docs/producer-review-runbook.md`

**Step 1: Add a failing RLS/grant test**

For every application-owned public table, assert `relrowsecurity = true` and no direct privileges for `anon` or `authenticated`:

```ts
const exposed = await pool.query(`
  select c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname <> 'schema_migrations'
`)

expect(exposed.rows.every((row) => row.relrowsecurity)).toBe(true)
```

Run `npm run test:db` and expect failure.

**Step 2: Add the forward-only policy migration**

Use an explicit table list. For each table:

```sql
alter table public.sessions enable row level security;
revoke all on table public.sessions from anon, authenticated;
```

Do not create permissive policies. Server routes use the service-role client. Include all current application tables, including replay, consent, rate-limit, and deletion tables introduced later in this plan.

**Step 3: Add a service-role and anon smoke test**

Assert the configured server role can perform representative operations while anon cannot select or insert. The test must use distinct database roles, not only inspect catalog strings.

**Step 4: Document rollout checks**

Add production-shaped-copy, grant inventory, backup, and PostgREST smoke instructions. State that this migration must be dry-run before live application.

**Step 5: Verify and commit**

Run `npm run test:db` and commit:

```powershell
git add supabase/migrations/018_public_schema_rls.sql tests/integration docs/producer-review-runbook.md
git commit -m "security: deny direct public database access"
```

### Task 4: Require Authenticated Chat And Enforce Abuse Limits

**Files:**
- Create: `supabase/migrations/019_api_rate_limits.sql`
- Create: `lib/security/rate-limit.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/sessions/route.ts`
- Modify: `lib/conversation/careers-redirect.ts`
- Modify: `tests/api/chat-route.test.ts`
- Modify: `tests/api/sessions-route.test.ts`
- Create: `tests/integration/rate-limit.test.ts`

**Step 1: Add failing boundary tests**

Cover:

- missing session/capability cannot invoke any provider;
- omitted `sessionId` cannot bypass limits;
- wrong origin is rejected before parsing/provider work;
- oversized body returns `413`;
- careers intent returns the fixed redirect before provider invocation;
- concurrent requests share one database-backed allowance.

Expected provider assertion:

```ts
expect(global.fetch).not.toHaveBeenCalled()
expect(response.status).toBe(401)
```

**Step 2: Add an atomic database limiter**

Create a small rate-limit table and `consume_rate_limit(key, window_seconds, limit)` SQL function using `insert ... on conflict ... do update` in one statement. Hash IP/capability material before storage and use separate buckets for session creation and chat.

**Step 3: Authenticate before model work**

Require `requireSession()` for every provider-backed chat request. Run deterministic careers and safe static scope responses before provider invocation but after request size/origin checks. Remove the optional authenticated-draft path.

**Step 4: Enforce bounded input**

Reject excessive `Content-Length`, message count, per-message length, and total characters through the shared Zod contract before provider calls.

**Step 5: Verify and commit**

Run:

```powershell
npx vitest run tests/api/chat-route.test.ts tests/api/sessions-route.test.ts tests/integration/rate-limit.test.ts
```

Commit:

```powershell
git add supabase/migrations/019_api_rate_limits.sql app/api lib tests
git commit -m "security: authenticate and rate limit chat"
```

### Task 5: Make Consent A Prior Server Transition

**Files:**
- Create: `supabase/migrations/020_session_consents.sql`
- Create: `app/api/projects/[sessionId]/consent/route.ts`
- Create: `lib/privacy/session-consent.ts`
- Modify: `app/api/telegram/upload/route.ts`
- Modify: `app/api/attachments/link/route.ts`
- Modify: `app/api/leads/finalize/route.ts`
- Modify: `lib/api/client.ts`
- Modify: `components/widget/attachment-dropzone.tsx`
- Create: `tests/api/session-consent.test.ts`
- Modify: `tests/api/telegram-upload.test.ts`
- Modify: `tests/api/attachments-link.test.ts`
- Modify: `tests/api/leads-finalize.test.ts`

**Step 1: Add consent-forgery regressions**

Prove that including `producerShare: true` or consent JSON in upload, link, or finalize requests cannot create consent. Expect `403 consent_required` and no insert/send.

**Step 2: Add an append-only consent ledger**

Create `session_consents` with session foreign key, scope enum/check (`analysis`, `producer_transfer`), notice version, granted boolean, provenance, and timestamp. Add a uniqueness/index strategy that supports reading the latest transition per scope.

**Step 3: Add the authenticated transition route**

Validate capability, exact origin, supported notice version, scope, and an explicit affirmative action. Persist the transition before returning canonical consent state.

```ts
const ConsentTransitionSchema = z.object({
  scope: z.enum(['analysis', 'producer_transfer']),
  granted: z.boolean(),
  noticeVersion: z.literal(CURRENT_NOTICE_VERSION),
})
```

**Step 4: Remove action-self-authorization**

Upload/link/finalize routes ignore submitted consent fields and call `requireConsent(sessionId, scope)`. Finalization derives packet scope only from ledger state.

**Step 5: Update the client flow**

Record consent first, then perform upload/link/finalize. If transition persistence fails, keep the action blocked and show a retryable error.

**Step 6: Verify and commit**

Run focused API and component tests, then commit:

```powershell
git add supabase/migrations/020_session_consents.sql app/api lib components tests
git commit -m "security: persist explicit consent transitions"
```

### Task 6: Centralize Atomic Canonical Draft Writes

**Files:**
- Create: `supabase/migrations/021_atomic_draft_updates.sql`
- Create: `lib/conversation/canonical-draft.ts`
- Modify: `app/api/projects/[sessionId]/draft/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/attachments/link/route.ts`
- Modify: `app/api/telegram/upload/route.ts`
- Modify: `app/api/projects/[sessionId]/reset/route.ts`
- Modify: `lib/api/contracts.ts`
- Modify: `lib/api/client.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Create: `tests/integration/canonical-draft.test.ts`
- Modify: `tests/api/chat-route.test.ts`
- Modify: `tests/api/project-delete.test.ts`

**Step 1: Add concurrent-write failing tests**

Start two writes from version 3. Assert exactly one returns version 4 and the other returns conflict. Add a chat persistence failure test proving no successful draft update is returned.

**Step 2: Add a compare-and-swap SQL function**

Implement one function that updates only when `draft_version = expected_version` and returns the canonical draft/version. Distinguish conflict from database failure without a read/check/write gap.

Core predicate:

```sql
update public.sessions
set draft = next_draft,
    draft_version = draft_version + 1,
    updated_at = now()
where id = target_session_id
  and draft_version = expected_version
returning draft, draft_version;
```

**Step 3: Route all writers through one TypeScript adapter**

`updateCanonicalDraft()` returns a discriminated union:

```ts
type CanonicalDraftResult =
  | { ok: true; draft: ConversationDraft; version: number }
  | { ok: false; reason: 'conflict'; draft: ConversationDraft; version: number }
  | { ok: false; reason: 'unavailable' }
```

Remove route-local update shapes and unchecked `as never` casts.

**Step 4: Return canonical chat state**

Chat responses include the persisted draft and new version. The widget replaces local draft/version from that response rather than applying an unversioned merge. On manual edit conflict, preserve the attempted value and offer explicit retry/reapply.

**Step 5: Verify and commit**

Run canonical draft integration, API, and widget tests. Commit:

```powershell
git add supabase/migrations/021_atomic_draft_updates.sql app/api lib components tests
git commit -m "fix: make canonical draft writes atomic"
```

### Task 7: Make Finalization Transactional And Idempotent

**Files:**
- Create: `supabase/migrations/022_finalize_lead_transaction.sql`
- Create: `lib/handoff/finalize.ts`
- Modify: `app/api/leads/finalize/route.ts`
- Modify: `lib/qualification/score.ts`
- Modify: `lib/handoff/routing.ts`
- Modify: `tests/api/leads-finalize.test.ts`
- Create: `tests/integration/finalization.test.ts`

**Step 1: Add repeated/concurrent finalization tests**

Send the same approval twice sequentially and concurrently. Assert one lead, one outbox record, one stable case ID, and equivalent successful responses. Add rollback tests at each former partial-write boundary.

**Step 2: Derive server-owned qualification**

Accept approval intent and expected draft version only. Recompute qualification status, score, routing destination, and next step from canonical draft and explicit operational signals. Remove client ownership of these fields.

**Step 3: Add a transactional finalization function**

Use stable key `sessionId:producer-approval:<draftVersion>`. In one transaction/function:

1. lock/load session and consent;
2. validate expected version and substance;
3. insert/upsert lead with non-null `idempotency_key`;
4. update session finalization state;
5. insert/upsert one outbox row;
6. return canonical IDs and queue status.

**Step 4: Keep persistence and delivery separate**

The route returns `persisted: true` only after transaction commit. Handoff delivery remains queued/delivered/retryable state and never changes brief persistence truth.

**Step 5: Verify and commit**

Run route and real database finalization tests. Commit:

```powershell
git add supabase/migrations/022_finalize_lead_transaction.sql app/api/leads lib tests
git commit -m "fix: finalize leads transactionally"
```

### Task 8: Own Outbox Leases And Resume Webhooks

**Files:**
- Create: `supabase/migrations/023_delivery_claim_ownership.sql`
- Modify: `lib/handoff/outbox.ts`
- Modify: `app/api/internal/handoff-dispatch/route.ts`
- Modify: `app/api/telegram/webhook/route.ts`
- Modify: `lib/telegram.ts`
- Modify: `vercel.json`
- Modify: `tests/handoff/outbox.test.ts`
- Modify: `tests/api/handoff-dispatch-events.test.ts`
- Modify: `tests/api/telegram-webhook.test.ts`
- Create: `tests/integration/delivery-claims.test.ts`

**Step 1: Add stale-owner and replay-failure tests**

Prove a stale worker cannot mark a reclaimed row delivered/failed. Prove a webhook failure after its replay marker can be retried and completed.

**Step 2: Add claim tokens and conditional completion**

Add `claim_token uuid`, processing state, and attempt metadata. Claim rows atomically and require `(id, claim_token, status='claiming')` for heartbeat, delivered, and failed transitions. Treat zero affected rows as lost ownership.

**Step 3: Bound external calls**

Use `AbortSignal.timeout()` below the lease duration. Recheck ownership immediately before send and condition terminal state afterward. Document Telegram's unavoidable crash-after-send ambiguity rather than claiming exactly once.

**Step 4: Make webhook replay stateful**

Store `processing`, `completed`, or retryable `failed` with attempt timestamps. Database side effects and completed state occur transactionally where possible; retries resume incomplete work.

**Step 5: Align cron operations**

Drain a bounded batch within runtime, set retry delays consistent with the two-minute cadence, expose oldest-pending/backlog metrics, and update operational docs.

**Step 6: Verify and commit**

Run focused unit and database concurrency tests. Commit:

```powershell
git add supabase/migrations/023_delivery_claim_ownership.sql app/api lib tests vercel.json docs
git commit -m "fix: own delivery leases and resume webhooks"
```

### Task 9: Make Uploads Durable Or Explicitly Unavailable

**Files:**
- Create: `lib/uploads/private-storage.ts`
- Modify: `app/api/telegram/upload/route.ts`
- Modify: `lib/uploads/quarantine.ts`
- Modify: `lib/uploads/extract-text.ts`
- Modify: `components/widget/attachment-dropzone.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `.env.example`
- Modify: `tests/api/telegram-upload.test.ts`
- Modify: `tests/uploads/quarantine.test.ts`
- Modify: `tests/widget/attachment-dropzone.test.tsx`

**Step 1: Add failing durability and resource-limit tests**

Assert:

- authentication and origin checks happen before multipart parsing;
- oversized `Content-Length` returns `413`;
- analysis-only success includes a retrievable private storage path;
- unavailable private storage returns `503 upload_unavailable` and no retained claim;
- filenames are not emitted in logs/events;
- decompression/extraction limits abort safely.

**Step 2: Persist validated bytes privately**

After bounded validation, write analysis-only files to a private Supabase bucket with generated object keys, detected MIME, checksum, status, and retention deadline. Never use the original filename in the object key or logs.

**Step 3: Bound extraction**

Limit input size, decompressed output, parser time, and concurrency. If isolation cannot be guaranteed for a format, remove that format from the analysis allowlist while retaining safe transfer behavior after producer consent.

**Step 4: Remove the legacy local-only uploader**

Route every file action through `AttachmentDropzone`. Remove messages that say a local preview was received. Add explicit uploading, retained, shared, failed, retry, and remove controls.

**Step 5: Verify and commit**

Run upload API, quarantine, and component tests. Commit:

```powershell
git add app/api/telegram/upload lib/uploads components tests .env.example
git commit -m "fix: retain validated uploads truthfully"
```

### Task 10: Implement Durable Deletion And Retention

**Files:**
- Create: `supabase/migrations/024_deletion_jobs_and_retention.sql`
- Create: `lib/privacy/deletion.ts`
- Modify: `app/api/projects/[sessionId]/delete/route.ts`
- Create: `app/api/internal/deletion-dispatch/route.ts`
- Modify: `vercel.json`
- Modify: `app/privacy/page.tsx`
- Modify: `lib/privacy/notice.ts`
- Modify: `docs/producer-review-runbook.md`
- Modify: `tests/api/project-delete.test.ts`
- Create: `tests/integration/deletion.test.ts`

**Step 1: Add a failing end-to-end deletion test**

Create a session with child messages, links, uploads, leads, and outbox data. Request deletion, run the authenticated worker, and assert child rows/storage objects are removed or anonymized according to policy. Assert the job retains no deleted PII.

**Step 2: Add durable jobs and retention fields**

Create an idempotent deletion job keyed by session, with requested/processing/completed/failed state, lease ownership, attempts, and timestamps. Add retention deadlines where required for quarantine and operational records.

**Step 3: Implement the worker**

Delete private storage objects first, then delete the session in a transaction so foreign-key cascades remove owned rows. Record completion using the opaque job ID, not the session's contact data. Document Telegram message/backups limitations and manual escalation.

**Step 4: Expose truthful status and privacy details**

The public route returns request ID and status, not `deleted: false` as a terminal response. Expand privacy details with retention periods, recipients, deletion SLA, backups, Telegram limits, and contact route.

**Step 5: Verify and commit**

Run deletion route/integration tests and commit:

```powershell
git add supabase/migrations/024_deletion_jobs_and_retention.sql app/api lib/privacy app/privacy docs tests vercel.json
git commit -m "feat: process deletion requests durably"
```

### Task 11: Make Relay, Approval, And Scheduling UI Truthful

**Files:**
- Modify: `app/api/telegram/relay/route.ts`
- Modify: `lib/api/client.ts`
- Modify: `components/widget/review-panel.tsx`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/chat/calendly-embed.tsx`
- Modify: `app/api/telegram/schedule-complete/route.ts`
- Modify: `tests/widget/review-panel.test.tsx`
- Modify: `tests/widget/widget-overlay-approved-confirmation.test.tsx`
- Modify: `tests/api/telegram-relay-events.test.ts`
- Modify: `tests/chat/calendly-embed.test.tsx`

**Step 1: Add failing retry/state tests**

Cover approval failure followed by successful retry, relay sending before delivered, failed relay with visible retry, no “team connected” before a real team reply, and pending booking verification after browser events.

**Step 2: Use explicit operation states**

Replace duplicate pending refs/state with discriminated states:

```ts
type ApprovalState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; delivery: 'queued' | 'delivered' | 'retryable' }
  | { status: 'failed'; message: string }
```

Control pending state in one owner. Clear it in every failure path.

**Step 3: Preserve full relay outcomes**

The client retains persistence/queue/delivery fields. Show `Sending...` until the checked response, `Delivered` only when durable mapping and Telegram acceptance both succeed, and a retry control otherwise.

**Step 4: Keep Calendly fail-safe**

Validate origin and the actual inline/fallback iframe source. Browser events set only `pending verification`. Keep the server completion route closed until a signed provider callback with reliable session correlation is implemented and tested.

**Step 5: Verify and commit**

Run focused route and component tests. Commit:

```powershell
git add app/api/telegram lib/api components tests
git commit -m "fix: show truthful operation states"
```

### Task 12: Split Cohesive Widget Controllers

**Files:**
- Create: `components/widget/use-session-draft.ts`
- Create: `components/widget/use-team-relay.ts`
- Create: `components/widget/use-conversation.ts`
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `lib/api/contracts.ts`
- Modify: `lib/api/client.ts`
- Modify: `tests/api/chat-client.test.ts`
- Modify: `tests/widget/widget-overlay-session.test.tsx`
- Modify: `tests/widget/widget-overlay-intent.test.tsx`

**Step 1: Lock behavior with controller tests**

Add tests for session bootstrap/reset, canonical version replacement, team polling preservation on errors, and conversation submission. Replace arbitrary sleeps with fake timers or condition-based assertions.

**Step 2: Unify the chat contract**

Define one Zod request/response contract in `lib/api/contracts.ts`, derive types with `z.infer`, use it in route and client, and route the widget through `chatRequest()`. Remove unused browser `capturedFields` and silently filtered role variants.

**Step 3: Extract ownership, not markup shuffling**

- `useSessionDraft`: capability session lifecycle, canonical draft/version, consent, edit/reset/delete.
- `useTeamRelay`: polling, handoff state, requested uploads/scheduling, relay retries.
- `useConversation`: local/provider routing, submission state, canonical response application.

Keep rendering components small and props explicit. Remove state/ref values from `WidgetOverlay` when ownership moves; do not mirror them.

**Step 4: Verify reduction**

Run focused tests and compare line/state counts. The target is to remove duplicate state ownership and reduce `WidgetOverlay` substantially without increasing total complexity through pass-through wrappers.

**Step 5: Commit**

```powershell
git add components/widget lib/api tests
git commit -m "refactor: separate widget state controllers"
```

### Task 13: Complete Desktop, Mobile, And Accessibility Behavior

**Files:**
- Modify: `components/widget/widget-overlay.tsx`
- Modify: `components/widget/widget-overlay-parts.tsx`
- Modify: `components/widget/attachment-dropzone.tsx`
- Modify: `components/chat/calendly-embed.tsx`
- Modify: `tests/widget/widget-overlay-a11y.test.tsx`
- Modify: `tests/widget/attachment-dropzone.test.tsx`
- Modify: `tests/e2e/intake.spec.ts`
- Modify: `tests/e2e/mobile-intake.spec.ts`
- Modify: `playwright.config.ts`

**Step 1: Add failing accessibility tests**

Cover focus restoration, mobile focus containment, nested modal focus/Escape, `role="log"` announcements, keyboard file selection, ARIA tab arrow navigation, visible focus, and approval/upload failure recovery.

**Step 2: Apply one dialog contract at all widths**

Remove the mobile focus-trap bypass. Add `aria-modal`, background isolation, opener restoration, nested-modal containment, and logical focus advancement after consent/intake/scheduling transitions.

**Step 3: Fix responsive geometry**

Use `100dvh` with a safe fallback, `env(safe-area-inset-*)`, scrollable constrained popovers, footer safe-area padding, and a Calendly container that can shrink below 320px. Ensure chat/footer remain visible with software keyboards.

**Step 4: Fix touch and text sizing**

Use at least 44px hit areas for mobile actions and 16px mobile form text. Raise dense metadata/action text to legible sizes and preserve visible `:focus-visible` styles.

**Step 5: Expand Playwright**

Add Chromium widths 320/375/390/412 and mobile WebKit. Remove `force: true`, honor reduced motion, enable traces/screenshots on failure, and cover attachments, retry, reset/delete confirmation, focus restoration, narrow Calendly, and scroll containment.

**Step 6: Verify and commit**

Run:

```powershell
npx vitest run tests/widget
npx playwright test
```

Commit:

```powershell
git add components tests playwright.config.ts
git commit -m "fix: harden responsive and accessible widget flows"
```

### Task 14: Remove Dead Enforcement Code And Align Documentation

**Files:**
- Delete: `lib/trust/gates.ts`
- Delete: `tests/trust/gates.test.ts`
- Delete: `lib/observability/trust-metrics.ts`
- Delete: `tests/observability/trust-metrics.test.ts`
- Delete: `lib/supabase/client.ts` if still unused
- Modify: `lib/env.ts`
- Modify: `lib/logger.ts`
- Modify: `lib/observability/events.ts`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/trust-metrics.md`
- Modify: `docs/producer-review-runbook.md`

**Step 1: Prove modules are unused**

Run:

```powershell
rg "trust/gates|trust-metrics|createBrowserSupabaseClient|MONDAY_API" . --glob '!node_modules/**'
```

Expected: only definitions/tests/documentation remain. If production callers exist after prior tasks, consolidate rather than delete.

**Step 2: Consolidate sanitization**

Create one recursive allowlist sanitizer shared by logger and trust events. Store stable error codes only. Remove original filenames, Telegram identifiers, raw error objects, and duplicate sensitive-key lists.

**Step 3: Remove dead code and stale configuration**

Delete test-only enforcement abstractions after authoritative routes/tests cover the behavior. Remove unused Monday variables and browser Supabase client. Remove obsolete schedule client helpers if still unreachable.

**Step 4: Correct product and operational documentation**

README must describe careers redirect, current readiness rules, durable quarantine behavior, complete migrations, required secrets, truthful handoff states, retention, and current route protection. Mark superseded design plans clearly rather than presenting contradictory behavior as current.

**Step 5: Verify and commit**

Run lint, typecheck, tests, secret scans, and `git diff --check`. Commit:

```powershell
git add -A
git commit -m "chore: remove stale trust code and align docs"
```

### Task 15: Add A Real Critical Journey And Release Gates

**Files:**
- Create: `tests/e2e/real-intake.spec.ts`
- Create: `tests/support/external-service-stub.ts`
- Modify: `playwright.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `docs/producer-review-runbook.md`

**Step 1: Add a failing unmocked critical journey**

Run the browser against real session, chat, draft, finalization, outbox, dispatch, webhook, and polling routes backed by disposable PostgreSQL. Stub only external HTTP boundaries. Validate request bodies, auth headers, and provider signatures in the stub.

Journey assertions:

1. notice and persisted session;
2. capability-authorized chat and canonical draft;
3. explicit producer consent;
4. idempotent approval;
5. one lead and one outbox row;
6. worker dispatch to Telegram stub;
7. signed webhook reply;
8. reply visible in browser;
9. deletion request and worker completion.

**Step 2: Harden Playwright diagnostics**

Configure `forbidOnly`, CI retries/workers, `trace: 'retain-on-failure'`, screenshots, video for failures, and report artifact upload. Install browsers once in CI.

**Step 3: Order release jobs correctly**

Require database, security, unit/integration, build, audit, and E2E jobs before any post-deployment webhook configuration. Make missing production setup secrets fail rather than silently skip. Configure the webhook only against an immutable deployed URL after smoke checks.

**Step 4: Verify and commit**

Run the complete local gate set and commit:

```powershell
git add tests/e2e tests/support playwright.config.ts .github/workflows/ci.yml package.json docs
git commit -m "test: prove the real intake and handoff journey"
```

### Task 16: Final Expert Review And Verification

**Files:**
- Modify as required by verified findings only.
- Update: `docs/plans/2026-07-13-release-hardening-implementation.md` with final evidence if useful.

**Step 1: Run independent reviews in parallel**

Dispatch read-only experts for security/privacy, backend/data, desktop UI/UX, mobile/accessibility, QA/release, and code hygiene against `a5799b2..HEAD`. Require severity, exact file/line evidence, reproduction, and minimal correction.

**Step 2: Resolve all Critical and High findings with TDD**

Do not waive findings without concrete code/test evidence. Record any intentionally deferred Medium/Low risk and owner.

**Step 3: Run final verification sequentially**

```powershell
npm run lint
npx tsc --noEmit
npm run build
npm test
npm run test:db
npm run test:e2e
npm audit --audit-level=high
git diff --check a5799b2..HEAD
```

Expected: every command exits 0. Record exact test counts and browser projects.

**Step 4: Inspect repository hygiene**

Check status, diff, generated artifacts, secrets, environment files, logs, screenshots/reports, TODO/FIXME, raw `console.*`, and unexpected dependencies. Do not commit generated reports or credentials.

**Step 5: Request owner decision**

Present changed behavior, migration/rollout order, verification evidence, remaining risks, and explicit options to merge, deploy, or continue hardening. Do not merge, deploy, or push without approval.
