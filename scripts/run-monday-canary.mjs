import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(resolve(root, 'config/monday-crm-schema.json'), 'utf8'));
const execute = process.argv.includes('--execute');
const evidencePath = process.env.MONDAY_CANARY_EVIDENCE_PATH ?? resolve(root, '.artifacts/monday-canary-evidence.jsonl');
const migrationVersions = ['044', '047', '048', '049', '052', '053'];
const migrationSources = [
  '044_monday_crm_projection_tables.sql',
  '047_atomic_crm_approval.sql',
  '048_monday_sync_state_machine.sql',
  '049_monday_crm_lifecycle.sql',
  '052_monday_scheduler_health.sql',
  '053_monday_reconciliation.sql',
];

function evidence(event, details = {}) {
  mkdirSync(resolve(evidencePath, '..'), { recursive: true });
  appendFileSync(evidencePath, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertDormantLanes() {
  if (process.env.MONDAY_UPSERT_ENABLED !== 'false' || process.env.MONDAY_CLEANUP_ENABLED !== 'false') {
    throw new Error('Canary requires both Monday feature lanes to remain false; it does not enable them.');
  }
}

async function monday(query, variables, idempotencyKey) {
  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: required('MONDAY_API_TOKEN'),
      'API-Version': '2026-07',
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data || body.errors?.length) throw new Error(`Monday canary request failed (${response.status})`);
  return body.data;
}

async function main() {
  if (!execute) throw new Error('Refusing to contact Monday without --execute.');
  assertDormantLanes();
  if (process.env.MONDAY_BOARD_ID !== schema.boardId || process.env.MONDAY_API_VERSION !== '2026-07') throw new Error('Canary requires the checked-in Monday board and API version.');
  if (!migrationSources.every((source) => existsSync(resolve(root, 'supabase/migrations', source)))) throw new Error('Required Monday migration sources through 053 are missing.');
  if (required('MONDAY_CANARY_MIGRATIONS_VERIFIED') !== '1') throw new Error('Canary requires CI migration verification through 053.');

  const schemaCheck = spawnSync(process.execPath, ['scripts/verify-monday-schema.mjs'], { cwd: root, encoding: 'utf8', env: process.env });
  if (schemaCheck.status !== 0) throw new Error('Live Monday schema fingerprint does not match the checked-in contract.');

  const crmRecordId = randomUUID();
  const itemName = `Balance Assist canary ${crmRecordId.slice(0, 8)}`;
  const sourceValues = { [schema.columns.crm_record_id.id]: crmRecordId, [schema.columns.qualification_status.id]: { index: schema.statusLabelIds.qualification_status.needs_review } };
  const ownedIds = schema.mondayOwnedColumns.map((name) => schema.columns[name].id);
  let itemId;
  let beforeOwned;
  try {
    const created = await monday('mutation Create($boardId: ID!, $itemName: String!, $values: JSON!) { create_item(board_id: $boardId, item_name: $itemName, column_values: $values) { id } }', { boardId: schema.boardId, itemName, values: JSON.stringify(sourceValues) }, randomUUID());
    itemId = created.create_item?.id;
    if (typeof itemId !== 'string' || !itemId) throw new Error('Canary create did not return an item ID.');

    const inspected = await monday('query CanaryItem($ids: [ID!], $columns: [String!]) { items(ids: $ids, exclude_nonactive: false) { id board { id } column_values(ids: $columns) { id text } } }', { ids: [itemId], columns: ownedIds });
    const item = inspected.items?.[0];
    if (item?.board?.id !== schema.boardId) throw new Error('Canary item board verification failed.');
    beforeOwned = JSON.stringify(item.column_values ?? []);
    await monday('mutation Update($boardId: ID!, $itemId: ID!, $values: JSON!) { change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id } }', { boardId: schema.boardId, itemId, values: JSON.stringify(sourceValues) }, randomUUID());
    const after = await monday('query CanaryOwned($ids: [ID!], $columns: [String!]) { items(ids: $ids, exclude_nonactive: false) { column_values(ids: $columns) { id text } } }', { ids: [itemId], columns: ownedIds });
    if (JSON.stringify(after.items?.[0]?.column_values ?? []) !== beforeOwned) throw new Error('Canary update changed Monday-owned fields.');

    const found = await monday('query CanaryFind($boardId: ID!, $columns: [ItemsPageByColumnValuesQuery!]!) { items_page_by_column_values(board_id: $boardId, columns: $columns, limit: 2) { items { id } } }', { boardId: schema.boardId, columns: [{ column_id: schema.columns.crm_record_id.id, column_values: [crmRecordId] }] });
    if (found.items_page_by_column_values?.items?.length !== 1) throw new Error('Canary reconciliation lookup did not find exactly one item.');
    evidence('canary_verified', { migrationVersions, schemaVerified: true, ownerFieldsUnchanged: true, reconciled: true });
  } finally {
    if (itemId) {
      const scrubValues = Object.fromEntries(schema.sourceOwnedColumns.filter((name) => name !== 'crm_record_id').map((name) => [schema.columns[name].id, null]));
      try {
        await monday('mutation Scrub($boardId: ID!, $itemId: ID!, $values: JSON!) { change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id } }', { boardId: schema.boardId, itemId, values: JSON.stringify(scrubValues) }, randomUUID());
        await monday('mutation Delete($itemId: ID!) { delete_item(item_id: $itemId) { id } }', { itemId }, randomUUID());
        evidence('canary_cleanup_completed', { deleted: true });
      } catch {
        evidence('canary_cleanup_failed', { deleted: false });
        throw new Error('Canary cleanup failed; follow the Monday DSR escalation runbook.');
      }
    }
  }
}

main().catch((error) => {
  if (execute) evidence('canary_failed', { reason: error instanceof Error ? error.message : 'unknown' });
  console.error(error instanceof Error ? error.message : 'Monday canary failed.');
  process.exitCode = 1;
});
