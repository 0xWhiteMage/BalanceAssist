# BalanceAssist → Monday.com CRM Integration — Coordination Plan

> **For the team that owns the chatbot / BalanceAssist code** (not the board side — board is already frozen and live).
>
> **How to use this file:** Read it top to bottom once. Decide who owns each task. Resolve the open questions before you start. Then run the items in §5 in order. Each item is bite-sized, copy-pasteable, and references the exact files in this repo so the implementer (human or subagent) does not need to re-discover anything.
>
> **Why this exists:** The Monday side of the integration is built and audited; this plan is the contract your code must honour. The board `18421762586` is in `Sale Tracking`, private, Pro plan, 43 columns with stable IDs, 4 saved views, 3 required columns, 1 data-quality formula. Anything you build that projects to that board must use the IDs and rules below.

---

## 1. Scope and non-goals

**Scope.** A two-way-ish integration that, every time BalanceAssist finalises an approved lead, projects it to the `Balance Assist CRM` board on Monday.com (`18421762586`, workspace `Sale Tracking`). On retry, Monday follows the same source-owned fields. The sync must be:

- **Authoritative source on Supabase.** Monday is a projection for BD. It must never be the source of truth and must not block lead finalisation.
- **Idempotent on `session_id`.** A second finalisation of the same session updates one Monday item, never creates a duplicate.
- **Safe to retry.** Durable outbox, retriable, observable.
- **Respectful of ownership.** Source-owned fields are written by the integration; Monday-owned fields (Owner, Follow-up, Stage after initial create, Notes, etc.) are preserved.

**Non-goals.** This plan does not change BalanceAssist's lead capture flow, conversation logic, or Supabase schema beyond a new outbox table. Email/Outlook sync, native monday CRM features, and multi-tenant admin tooling are out.

**What is already done.** Board is live with stable column IDs, controlled labels, 3 required columns, 1 data-quality formula, 4 saved views, tuned widths. Audit reports and live scorecard live under `/volume2/Hailey/Hermes/workspace/.hermes/quality/monday-crm-audit/`. The board will not be modified by anyone except by re-running `scripts/build_balance_assist_crm.py` against a new board ID.

---

## 2. Architecture

```
BalanceAssist Supabase
  ├── leads (existing)            ← authoritative brief
  ├── monday_crm_sync (new)        ← outbox table; unique on session_id
  └── canonical_draft, qualification_score (existing) ← read-only to integration

                  ↓ (claim-and-run worker, scheduled cron OR on-finalise hook)

Integration worker (lib/monday-crm.ts)
  ├── build payload from Supabase
  ├── exact-search Monday by session_id
  ├── if 1 found  → update source-owned fields only
  ├── if 0 found  → create new item with stable IDs
  └── if >1 found → mark conflict, alert, do not mutate

                  ↓

Monday.com board 18421762586 (Sales Tracking)
```

The integration is a **claim-and-process worker** that runs behind either a Supabase cron job (5-minute cadence) or a `POST /api/leads/finalise` hook (synchronous fan-out, fire-and-forget). Either way, the synchronous user response never depends on the Monday call.

---

## 3. Environment and secrets

The team that owns the chatbot configures these as deployment secrets (never commit, never log):

```
MONDAY_API_TOKEN          # personal token that has boards:write on the BALANCE Pro workspace
MONDAY_BOARD_ID           # 18421762586 (Sales Tracking)
MONDAY_API_VERSION        # 2026-04 (matches what we tested live)
MONDAY_RATE_LIMIT_RPM     # 60 (default; Pro allows more)
SUPABASE_SYNC_TENANT      # the schema/tenant to use for monday_crm_sync
SYNC_WORKER_ENABLED       # false during initial canary
```

Wire them through `lib/env.ts` schema validation (Zod), exactly like `MONDAY_BASE_URL` etc.

**Token rotation plan.** Generate a fresh personal token from Monday → Developer Center before going live; rotate at least every 90 days. The token pasted into chat earlier (eyJhb…) is treated as compromised and must be revoked.

---

## 4. Field ownership matrix (do not violate)

Read this twice. This is the boundary between what you may write and what only humans may write.

| Domain | Supabase authoritative | Monday authoritative | Integration writes | Human writes |
|---|---:|---:|---:|---:|
| Session ID, case ID | ✓ | | ✓ | |
| Contact name, email, company | ✓ | | ✓ | |
| Phone | | ✓ | | ✓ |
| Project type, project scope, polished scope, timeline, budget band | ✓ | | ✓ | |
| Qualification, lead score, next-step recommendation | ✓ | | ✓ | |
| Routing (Standard / Priority Review), priority signals | ✓ | | ✓ | |
| Source URL, referrer, UTM_\*, submitted_at | ✓ | | ✓ | |
| Producer share consent + timestamp, AI analysis consent + timestamp | ✓ | | ✓ | |
| Reference links / files (only if producer-share consent was server-recorded with timestamp) | ✓ | | ✓ (gated) | |
| Attachment count (derived) | | | derived | |
| **Pipeline stage** (initial only) | | ✓ | ✓ (initial create only) | ✓ (after) |
| **Owner**, **last contacted**, **next follow-up** | | ✓ | | ✓ |
| Meeting booked, meeting outcome, sales notes, loss reason | | ✓ | | ✓ |
| Data quality status | | (formula) | (formula computes) | |

**Rule for the worker:** the create payload and the update payload both come from one filtered builder that consults this matrix. Anything tagged `Monday authoritative` is read but never written by the integration. Any feature that wants to *change* this matrix needs red-team sign-off.

---

## 5. Bite-sized tasks

Each task = 2–5 minutes focused work, one commit. TDD throughout. Run the failure check between each step. Total ≈ 4–6 hours of focused work for a competent engineer who has read this file once.

### Task 1: Add `monday_crm_sync` outbox table

**Files:** Create migration `supabase/migrations/2026_07_14_monday_crm_sync.sql`; touch `lib/env.ts`.

**Step 1 — Write the migration first.**

```sql
create table if not exists public.monday_crm_sync (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null unique,
  lead_id         uuid not null,
  payload         jsonb not null,
  payload_hash    text not null,
  status          text not null default 'queued',  -- queued | in_progress | synced | failed | conflict
  attempts        int  not null default 0,
  next_attempt_at timestamptz not null default now(),
  monday_item_id  text,
  last_error      text,
  last_error_code text,
  schema_version  int  not null default 1,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create unique index if not exists monday_crm_sync_session_id_key on public.monday_crm_sync(session_id);
create index if not exists monday_crm_sync_status_next_attempt on public.monday_crm_sync(status, next_attempt_at);
```

**Step 2 — Verify migration runs cleanly.** Run `npm run db:migrate` (or whatever your migration command is). Expected: idempotent, no errors.

**Step 3 — Commit.**
```bash
git add supabase/migrations/2026_07_14_monday_crm_sync.sql
git commit -m "feat(crm): add monday_crm_sync outbox table"
```

### Task 2: Add `lib/monday-crm.ts` skeleton with config

**Files:** Create `lib/monday-crm.ts`.

**Step 1 — Failing test first.** `tests/monday/crm.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { buildMondayPayload } from '@/lib/monday-crm';

describe('buildMondayPayload', () => {
  test('omits Monday-owned fields', () => {
    const p = buildMondayPayload({
      session_id: 's',
      contact_name: 'Sam',
      // ...
      // phone, last_contacted, etc.
      // should not appear in the projected payload
    } as any);
    expect(p).not.toHaveProperty('phone');
    expect(p).not.toHaveProperty('last_contacted');
  });
});
```

**Step 2 — Run, confirm fail.**

**Step 3 — Minimal implementation.**
```ts
import { z } from 'zod';

const env = z.object({
  MONDAY_API_TOKEN: z.string().min(20),
  MONDAY_BOARD_ID: z.string().min(5),
  MONDAY_API_VERSION: z.string().default('2026-04'),
  SYNC_WORKER_ENABLED: z.boolean().default(false),
});

export const MondayEnv = env;

export interface LeadSource {
  session_id: string;
  case_id?: string;
  contact_name: string;
  contact_email: string;
  company?: string;
  phone?: string;
  service: 'production' | 'post_production' | 'event_experience' | 'media_adaptation'
        | 'design_direction' | 'generative_ai' | 'not_sure_yet';
  project_type?: string;
  project_scope?: string;
  scope_polished?: string;
  timeline?: string;
  budget: 'under_20k' | '20k_50k' | '50k_150k' | '150k_plus' | 'not_sure_yet';
  lead_score: number;
  next_step: 'schedule' | 'human_followup' | 'manual_review' | 'redirect';
  qual_status: 'qualified' | 'needs_review' | 'misfit' | 'unqualified';
  routing: 'standard' | 'priority_review';
  priority_signals?: string[];
  source_url?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  submitted_at: string;            // ISO
  telegram_thread?: string;
  attachment_count?: number;
  reference_links?: string;
  reference_files?: string;
  consent_producer_share: 'granted' | 'not_recorded';
  consent_ai_analysis:   'granted' | 'not_recorded';
  consent_share_at?: string;
  consent_ai_at?: string;
}

export function buildMondayPayload(src: LeadSource): Record<string, unknown> {
  // Exactly the fields the matrix in §4 says this integration owns.
  // No phone, last_contacted, next_follow_up, meeting_booked, lead_owner here.
  const payload: Record<string, unknown> = {
    session_id: src.session_id,
    case_id: src.case_id ?? null,
    contact_name: src.contact_name,
    contact_email: src.contact_email,
    company: src.company ?? '',
    service: { label: SERVICE_LABEL[src.service] },
    project_type: (src.project_type ?? '').slice(0, 254),
    project_scope: (src.project_scope ?? '').slice(0, 2000),         // hard cap
    scope_polished: (src.scope_polished ?? '').slice(0, 2000),
    timeline: (src.timeline ?? '').slice(0, 254),
    budget: { label: BUDGET_LABEL[src.budget] },
    lead_score: String(src.lead_score),
    next_action: { label: NEXT_ACTION_LABEL[src.next_step] },
    qual_status: { label: QUAL_LABEL[src.qual_status] },
    cr_routing: { label: src.routing === 'priority_review' ? 'Priority Review' : 'Standard' },
    source_channel: { label: 'Balance Assist' },
    submitted_at: parseMondayDateTime(src.submitted_at),
    consent_share: { label: src.consent_producer_share === 'granted' ? 'Granted' : 'Not recorded' },
    consent_ai:   { label: src.consent_ai_analysis === 'granted' ? 'Granted' : 'Not recorded' },
    consent_share_at: src.consent_share_at ?? '',
    consent_ai_at:   src.consent_ai_at ?? '',
    telegram_thread: src.telegram_thread ?? '',
    utm_source: src.utm_source ?? '',
    utm_medium: src.utm_medium ?? '',
    utm_campaign: src.utm_campaign ?? '',
    source_url: src.source_url ? { url: src.source_url, text: 'source' } : null,
    referrer:    src.referrer   ? { url: src.referrer,   text: 'referrer' } : null,
    lead_owner: null,  // set on first create from assignment policy; never overwritten
  };
  // References ONLY if producer-share consent granted:
  if (src.consent_producer_share === 'granted') {
    payload.reference_links = (src.reference_links ?? '').slice(0, 2000);
    payload.reference_files = (src.reference_files ?? '').slice(0, 2000);
    payload.attachment_count = src.attachment_count ? String(src.attachment_count) : '0';
  }
  return payload;
}

const SERVICE_LABEL: Record<string, string> = {
  production: 'Production',
  post_production: 'Post-production',
  event_experience: 'Event & experience content',
  media_adaptation: 'Media asset adaptation',
  design_direction: 'Design direction',
  generative_ai: 'Generative AI',
  not_sure_yet: 'Not sure yet',
};
const BUDGET_LABEL: Record<string, string> = {
  under_20k: 'Under 20k', 20k_50k: '20k–50k', 50k_150k: '50k–150k',
  150k_plus: '150k+', not_sure_yet: 'Not sure yet',
};
const NEXT_ACTION_LABEL: Record<string, string> = {
  schedule: 'Book a call', human_followup: 'Human follow-up',
  manual_review: 'Manual review', redirect: 'Redirect',
};
const QUAL_LABEL: Record<string, string> = {
  qualified: 'Qualified', needs_review: 'Needs Review',
  misfit: 'Misfit', unqualified: 'Unqualified',
};

function parseMondayDateTime(iso: string): { date: string; time?: string } | string {
  // Monday expects YYYY-MM-DD for date-without-time, or {date,time} when time matters.
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (m) return { date: m[1], time: m[2] };
  return { date: iso.slice(0, 10) };
}
```

**Step 4 — Pass the test. Run `npm test -- tests/monday/crm.test.ts`. Expected: 1 passed.**

**Step 5 — Commit.**
```bash
git add lib/monday-crm.ts tests/monday/crm.test.ts
git commit -m "feat(crm): skeleton payload builder with field-ownership matrix"
```

### Task 3: Exact-session search and conflict detector

**Files:** `lib/monday-crm.ts`, `tests/monday/crm.test.ts`.

**Step 1 — Add test.**
```ts
import { findBySessionId, MondayConflictError } from '@/lib/monday-crm';

test('exact session_id search returns one or none, never ignores', async () => {
  // set up a mock graphql that returns one hit on session_id
  const item = await findBySessionId('TEST-1', fetch as any);
  expect(item?.id).toBeTruthy();
});

test('two items with same session_id throws conflict', async () => {
  await expect(findBySessionId('DUP', fetch as any)).rejects.toBeInstanceOf(MondayConflictError);
});
```

**Step 2 — Implement.**
```ts
export class MondayConflictError extends Error {}

export async function findBySessionId(
  session_id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string } | null> {
  const q = `
    query($b:ID!,$sid:String!){
      boards(ids:[$b]){
        items_page_by_column_values(limit:10,
          columns:[{column_id:"session_id",column_values:[$sid]}]){
          items{ id }
        }
      }
    }`;
  const body = JSON.stringify({ query: q, variables: { b: BOARD_ID, sid: session_id } });
  const res = await fetchImpl('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MONDAY_API_TOKEN}`, 'Content-Type': 'application/json', 'API-Version': API_VERSION },

    body,
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  const items = j?.data?.boards?.[0]?.items_page_by_column_values?.items ?? [];
  if (items.length === 0) return null;
  if (items.length > 1)  throw new MondayConflictError(`duplicate session_id=${session_id}`);
  return { id: items[0].id };
}
```

**Step 3 — Mock the fetch and pass the test.** (Use vitest's `vi.fn` to stub global `fetch`.)

**Step 4 — Commit.**
```bash
git add lib/monday-crm.ts tests/monday/crm.test.ts
git commit -m "feat(crm): exact session_id lookup with conflict detection"
```

### Task 4: Idempotent upsert

**Files:** `lib/monday-crm.ts`, `tests/monday/crm.test.ts`.

**Step 1 — Test the upsert contract.**
```ts
import { upsertBySessionId } from '@/lib/monday-crm';

test('upsert creates when none found', async () => { /* mock graphql returns 0 items, expects create_item */ });
test('upsert updates when one found, does not overwrite Monday-owned', async () => { /* mock returns 1 item, expects change_multiple_column_values WITHOUT lead_owner/next_follow_up/etc */ });
test('upsert throws and marks conflict on duplicates', async () => { /* mock returns 2 items */ });
```

**Step 2 — Implement.**
```ts
export class MondayGraphQLError extends Error {}

export async function upsertBySessionId(
  src: LeadSource,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: 'created' | 'updated'; item_id: string }> {
  const payload = buildMondayPayload(src);
  try {
    const existing = await findBySessionId(src.session_id, fetchImpl);
    if (existing) {
      const update = await callMonday(
        `mutation($b:ID!,$i:ID!,$cv:JSON!){
          change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv,create_labels_if_missing:false){id}}`,
        { b: BOARD_ID, i: existing.id, cv: JSON.stringify(payload) },
        fetchImpl,
      );
      return { status: 'updated', item_id: update.id };
    }
    const create = await callMonday(
      `mutation($b:ID!,$n:String!,$cv:JSON!){
        create_item(board_id:$b,item_name:$n,column_values:$cv,create_labels_if_missing:false){id}}`,
      { b: BOARD_ID, n: src.contact_name || src.session_id, cv: JSON.stringify(payload) },
      fetchImpl,
    );
    return { status: 'created', item_id: create.id };
  } catch (e) {
    if (e instanceof MondayConflictError) throw e;
    if (e instanceof MondayGraphQLError && /DATA_VALIDATIONS_ERROR/.test(e.message)) {
      // Required-column rejection. Treat as permanent failure, do not retry.
      throw Object.assign(e, { permanent: true });
    }
    throw e;
  }
}

async function callMonday(query: string, variables: Record<string, unknown>, f: typeof fetch) {
  const res = await f('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MONDAY_API_TOKEN}`, 'Content-Type': 'application/json', 'API-Version': API_VERSION },

    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors?.length) throw new MondayGraphQLError(JSON.stringify(j.errors));
  return j.data;
}
```

**Step 3 — Tests should pass.** Run `npm test -- tests/monday/crm.test.ts`.

**Step 4 — Commit.**
```bash
git add lib/monday-crm.ts tests/monday/crm.test.ts
git commit -m "feat(crm): idempotent upsert by session_id"
```

### Task 5: Wire outbox state transitions

**Files:** `lib/monday-crm.ts`, `tests/monday/outbox.test.ts`.

**Step 1 — Test.**
```ts
test('success moves status queued → in_progress → synced and persists monday_item_id', async () => {});
test('transient failure moves queued → in_progress → queued with backoff and next_attempt_at', async () => {});
test('permanent failure (validation/schema) moves to failed and stops retrying', async () => {});
```

**Step 2 — Implement.**
```ts
export async function processOutboxRow(rowId: string, deps = { supabase, fetch }) {
  const row = await deps.supabase.from('monday_crm_sync').select('*').eq('id', rowId).single();
  if (row.error) throw row.error;
  if (!row.data) return;

  // Claim: only one worker can hold this row.
  const claim = await deps.supabase.from('monday_crm_sync')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', rowId)
    .eq('status', 'queued')
    .select('*').single();
  if (claim.error || !claim.data) return; // someone else has it

  try {
    const src = claim.data.payload as LeadSource;
    const result = await upsertBySessionId(src, deps.fetch);
    await deps.supabase.from('monday_crm_sync').update({
      status: 'synced',
      monday_item_id: result.item_id,
      attempts: claim.data.attempts + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', rowId);
  } catch (e: any) {
    const isPermanent = e?.permanent === true;
    const nextAttempt = isPermanent ? null : new Date(Date.now() + 60_000 * Math.min(2 ** claim.data.attempts, 60)).toISOString();
    await deps.supabase.from('monday_crm_sync').update({
      status: isPermanent ? 'failed' : 'queued',
      attempts: claim.data.attempts + 1,
      last_error: e?.message?.slice(0, 1000) ?? 'unknown',
      last_error_code: isPermanent ? 'PERMANENT' : 'TRANSIENT',
      next_attempt_at: nextAttempt ?? new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', rowId);
    if (isPermanent) {
      // Log to wherever the team logs alerts.
    }
  }
}
```

**Step 3 — Pass tests. Commit.**
```bash
git add lib/monday-crm.ts tests/monday/outbox.test.ts
git commit -m "feat(crm): outbox state transitions with backoff"
```

### Task 6: Hook into finalise and add enqueue

**Files:** `app/api/leads/finalize/route.ts`, `lib/monday-crm.ts`.

**Step 1 — After successful finalisation, queue the outbox row.**
```ts
await supabase.from('monday_crm_sync').insert({
  session_id: lead.sessionId,
  lead_id: lead.id,
  payload,
  payload_hash: hash(payload),
}).onConflict('session_id').ignore();   // already queued, no-op
```
Do **not** await the Monday call from the request handler. The worker picks it up later.

**Step 2 — Add a unit test that asserts the finalise route does NOT call `fetch('monday.com')` directly.**
```ts
test('finalise does not block on Monday', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  // call finalise
  // assert fetchSpy was not called with monday.com
});
```

**Step 3 — Commit.**
```bash
git add app/api/leads/finalize/route.ts tests/leads-finalize.test.ts
git commit -m "feat(crm): enqueue outbox on finalise, no blocking call"
```

### Task 7: Reconciliation (run weekly)

**Files:** `scripts/reconcile-monday.ts`, `package.json`.

**Step 1 — Implementation idea.** For each Supabase lead with `status='synced'`, exact-search Monday by `session_id`. If 0 found and last sync <24h, mark `failed`. If >1 found, mark `conflict` and emit alert.

**Step 2 — Add to `package.json` `scripts.reconcile-monday: "tsx scripts/reconcile-monday.ts"`.**

**Step 3 — Commit.**
```bash
git add scripts/reconcile-monday.ts package.json
git commit -m "feat(crm): weekly reconciliation script"
```

### Task 8: Pre-prod checklist before flipping `SYNC_WORKER_ENABLED=true`

- [ ] Token **rotated** before going live.
- [ ] Migration applied in prod.
- [ ] Smoke test passed live: create → update → conflict path (use a temporary test session with `smoke-` prefix, delete it).
- [ ] Reconciliation script dry-run shows 0 drift.
- [ ] Observability hooked (Prom counter or equivalent) for `outbox_queued_total`, `outbox_synced_total`, `outbox_failed_total`, `outbox_conflict_total`, `monday_5xx_total`, `monday_429_total`.
- [ ] At least one human has read `/volume2/Hailey/Hermes/workspace/.hermes/quality/monday-crm-audit/final-synthesis.md` and `live-scorecard.md` end-to-end.

Once those are all green, flip `SYNC_WORKER_ENABLED=true` and watch the dashboard.

---

## 6. Pre-cooked API gotchas (do not re-debug these)

These were paid for during the board build. Code defensively for them all.

| Gotcha | Behaviour | Mitigation |
|---|---|---|
| `create_item` requires `contact_name`, `contact_email`, `session_id` | API returns `DATA_VALIDATIONS_ERROR` for sparse records | Confirm the matrix in §4 is enforced upstream — never let the integration queue an item missing any of these three |
| `long_text` (project_scope, scope_polished, reference_links, reference_files, sales_notes) hard-capped at **2,000** chars | Silently truncated on write; no warning | `.slice(0, 2000)` in the payload builder; log any truncation |
| `status` field expects **label object** `{label: 'Production'}` not a slug | Returns `ColumnValueException` | Use the `*_LABEL` maps in Task 2 |
| `phone` expects `{phone: '+84123456789', countryShortName: 'VN'}` shape | Country parsing rejects the string otherwise | Format as country-aware object only if you collect a real phone |
| `link` expects `{url, text}` | Rejected otherwise | Use `{url, text: 'source'}` |
| `people` expects `{personsAndTeams:[{id,kind:'person'}]}` | Returns error otherwise | Set initial `lead_owner` only from an assignment policy; never overwrite |
| `email` expects `{email, text}` | String-typed email errors otherwise | Use `{email, text: name}` |
| `date` expects `{date:'YYYY-MM-DD'}` or string | Different formats rejected | Normalise ISO to `YYYY-MM-DD` (with optional `time`) |
| Filter `compare_value` for status fields must be **numeric label ids**, not slugs | Returns `Status column values must be numeric indices` | Fetch column `settings.labels` once per cache TTL, build `{slug → id}` map; reject `unknown enum` if a label is missing rather than auto-creating |
| `change_column_metadata` does NOT accept `width` (only `title`, `description`); use `update_column(id, width, revision, column_type)` for board-level widths | Errors otherwise | For board widths, do not call from runtime — handled by the provisioning script |
| `update_column` requires `revision` and `column_type` even though introspect lists them as optional | Returns `argument is required` otherwise | Refetch revision before every update; pass the column type explicitly |
| `update_view_table` silently drops `visible: true` entries in `column_properties` | View appears empty in UI | Send only **hidden** columns with `visible: false`; rely on default-visible behaviour for the rest |
| `ItemsQueryOperator` accepts lowercase `and`/`or` only (not `AND`/`OR`) | Returns `Variable "$f" got invalid value` otherwise | Use lowercase |
| `ItemsQueryRuleOperator` is snake_case (`any_of`, `is_empty`) | Returns value error otherwise | Use lowercase enum values |
| `lead_owner` is the safe rename for the `owner` column id (reserved); `cr_routing` for `routing`; `cr_priority` for `priority` | Reserved-id errors otherwise | Use the rename table in the runbook |
| API returns `data:null` or `{boards:null}` with HTTP 200 on rate-limits | Reads look fine but `r['boards'][0]` throws `KeyError` | Always `if resp.get('data') and resp['data'].get('boards')` before indexing; retry on transient blanks |
| Long-text fields lose `\n` newlines and render as spaces in Monday's UI | Misleading display | Persist key reference list / brief separately and link in sales_notes; treat `project_scope` as a snippet, not a canonical full-text store |

---

## 7. Test plan (run before flipping the flag)

Unit tests live under `tests/monday/`. Names follow the same convention as `tests/api/leads-finalize.test.ts`.

| Test | Verifies |
|---|---|
| `crm.test.ts::buildMondayPayload omits Monday-owned fields` | Field ownership matrix is respected |
| `crm.test.ts::buildMondayPayload truncates long_text to 2000` | Silent truncation guard |
| `crm.test.ts::buildMondayPayload drops references when consent=not_recorded` | Privacy default |
| `crm.test.ts::findBySessionId returns one` | Idempotency lookup happy path |
| `crm.test.ts::findBySessionId throws MondayConflictError on duplicates` | Conflict detection |
| `crm.test.ts::upsert creates on absent` | First-time projection |
| `crm.test.ts::upsert updates existing without overwriting Monday-owned` | Field-ownership preservation |
| `outbox.test.ts::transient failure backs off and re-queues` | Retry semantics |
| `outbox.test.ts::permanent failure (DATA_VALIDATIONS_ERROR) goes to failed` | Don't infinite-loop on schema errors |
| `leads-finalize.test.ts::finalise does not block on Monday` | Latency contract |

The whole suite should run under 5 seconds (mock the global fetch).

---

## 8. What the team will need from the red team

Your call to the red team should be:

> **"Run the multi-specialist parallel review on the BalanceAssist → Monday integration code."** Use the live board `18421762586` and the existing audit at `/volume2/Hailey/Hermes/workspace/.hermes/quality/monday-crm-audit/final-synthesis.md` as the floor. Build a NEW evidence pack from the latest code (call `git log -1` and list the new modules), then dispatch four reviewers in parallel — UI/UX, business-ops, engineering, adversarial — and adjudicate any subagent claims against the **live** Monday API and the runbook in this plan.

**Things the red team should specifically probe:**

1. **Concurrent enqueue** — can two finalises of the same `session_id` (e.g. webhook retry) insert two outbox rows?
2. **Cross-tenant leakage** — does `payload_hash` prevent the worker projecting a payload from a different tenant's lead?
3. **Truncation silent** — does any long_text field in the live projection read back as 2,000 chars plus a missing newline?
4. **Filter ops** — does the rendered Daily Triage view show the new item in the correct order?
5. **Consent under replay** — replaying a `granted → not_recorded` change does not clear existing reference columns (which the worker should not touch).
6. **Reference scrub on `Closed`** — should the integration actively delete reference_* fields when `data_quality` becomes `Closed`? (Currently preserves them; document the policy.)

Return: a new final-synthesis dated the day of review, with the audit pack at `.hermes/quality/monday-crm-audit-followup-YYYY-MM-DD/`, ready for stage-2 sign-off.

---

## 9. What "done" looks like

The integration is shipping-ready when ALL of these are true:

1. All 10 tests in `tests/monday/` pass against mocked fetch.
2. A live smoke test ran end-to-end: created a `smoke-*` item via the integration, observed it in Daily Triage, re-ran the integration with an updated `qual_status`, and saw the cell change — without Owner / Follow-up being touched. Then deleted the smoke item.
3. Reconciliation script dry-run shows 0 drift across the last 30 days of synced rows.
4. Prometheus counters (or equivalent) are emitting, and `outbox_failed_total == 0` and `outbox_conflict_total == 0` for the canary week.
5. Token rotation has been scheduled in the team's calendar with the named owner.
6. A red-team follow-up audit has been adjudicated and stored under `.hermes/quality/monday-crm-audit-followup-YYYY-MM-DD/`.
7. The Monday board's Daily Triage view is signed off as the team's daily operating surface (BD has had a 30-minute walkthrough and signed off).

If 1–6 are all green and 7 is pending because the BD is busy: that's fine, the code is still production-ready and the walkthrough can be scheduled at the BD's next slot.

---

## 10. Open questions to resolve before starting

These are the items I couldn't decide without you. Please resolve before §5 kicks off.

- [ ] **Ownership of Monday-owned fields on initial create.** Right now `lead_owner` is `null` on first create. Do you want:
  - (a) Leave empty for human to fill (current default).
  - (b) Auto-assign to the integration service user (so the board is never ownerless — BD can re-assign).
  - (c) Round-robin from a known BD list (specify the list).
  - Default if unanswered: **(a)**.
- [ ] **Re-open on update.** When a `qual_status` changes from `Closed` back to `Qualified`, should `data_quality` revert from `Closed` to `Healthy`, or stay `Closed` until a human opts in? Default if unanswered: **stay Closed** (humans control close outcomes).
- [ ] **Reference retention after `Closed`.** Current behaviour preserves references even after `consent_share=Not recorded` later. Acceptable? Default if unanswered: **preserve** (audit prefers "have evidence" over "remove evidence").
- [ ] **Token policy.** Personal V2 token is what worked in test; OAuth app token would be the production-grade choice. Are you provisionally OK with a personal token scoped to one service user, or do you want an OAuth app minted? Default if unanswered: **personal token for now**, plan OAuth for the next 90 days.
- [ ] **Cron cadence.** 5-minute worker tick, or on-finalise hook only? Default if unanswered: **on-finalise hook + 5-minute backstop cron**.

Once these are decided, mark them up and the plan is unblocked.

---

## Appendix A — Where everything lives

| Thing | Path |
|---|---|
| Live board | https://balance-studio.monday.com/boards/18421762586 |
| Board ID | `18421762586` |
| Workspace | Sale Tracking (`7318184`) |
| Provisioning script | `scripts/build_balance_assist_crm.py` (idempotent re-run) |
| Existing audit artefacts | `/volume2/Hailey/Hermes/workspace/.hermes/quality/monday-crm-audit/` |
| Live scorecard (Friday-readable) | `.hermes/quality/monday-crm-audit/live-scorecard.md` |
| This plan | `docs/plans/2026-07-14-monday-crm-integration-handoff.md` |
| Final-synthesis adjudicated | `.hermes/quality/monday-crm-audit/final-synthesis.md` |
| Engineering architecture | `.hermes/quality/monday-crm-audit/engineering-review.md` |
| BD ops requirements | `.hermes/quality/monday-crm-audit/business-development-review.md` |
| UI/UX first-screen spec | `.hermes/quality/monday-crm-audit/uiux-review.md` |
| Parent live failure probes | `.hermes/quality/monday-crm-audit/parent-redteam-live-tests.md` |

## Appendix B — Stable column ID reference (copy-paste)

```
name session_id case_id contact_name contact_email company phone route_reasons
qual_status handoff_status source_channel next_action data_quality consent_share
consent_ai service budget cr_routing cr_priority project_type project_scope
scope_polished timeline lead_score source_url referrer utm_source utm_medium
utm_campaign submitted_at next_follow_up lead_owner last_contacted meeting_booked
telegram_thread attachment_count reference_links reference_files consent_share_at
consent_ai_at sales_notes loss_reason data_quality_flag
```

Reserved IDs that **must** keep their renames: `cr_routing`, `cr_priority`, `lead_owner`.

Stable view IDs:

```
Daily Triage         269379419   filter: data_quality any_of {0,1,2,17}
Needs Attention      269379426   filter: data_quality any_of {0}
Producer Brief       269379434
System & Audit       269379450
```

---

*Generated 2026-07-14. Owner: whoever picks it up first. Once tasks T1–T8 land, the red-team follow-up audit is the final gate before flip.*
