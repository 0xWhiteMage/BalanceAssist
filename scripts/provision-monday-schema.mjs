import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const schema = JSON.parse(await readFile(resolve(root, 'config/monday-crm-schema.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const token = process.env.MONDAY_API_TOKEN;
const configuredBoardId = process.env.MONDAY_BOARD_ID ?? schema.boardId;
const apiVersion = process.env.MONDAY_API_VERSION ?? schema.apiVersion;

if (!token) throw new Error('MONDAY_API_TOKEN is required');
if (configuredBoardId !== schema.boardId) throw new Error('MONDAY_BOARD_ID must match the checked-in schema contract');
if (apiVersion !== schema.apiVersion) throw new Error('MONDAY_API_VERSION must match the checked-in schema contract');

async function request(query, variables) {
  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: token, 'API-Version': apiVersion, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors?.length || !body?.data) {
    throw new Error(`Monday request failed (${response.status})`);
  }
  return body.data;
}

function fingerprint(validations) {
  return createHash('sha256')
    .update(JSON.stringify({ required_column_ids: [...validations.required_column_ids].sort(), rules: validations.rules ?? null }))
    .digest('hex');
}

async function inspect() {
  return request(
    'query BoardSchema($boardIds: [ID!], $boardId: ID!) { me { account { id } } boards(ids: $boardIds) { id board_kind workspace { id } columns { id type } } validations(id: $boardId, type: board) { required_column_ids rules } }',
    { boardIds: [schema.boardId], boardId: schema.boardId }
  );
}

function plan(data) {
  const board = data.boards?.[0];
  if (!board || data.me?.account?.id !== schema.accountId || board.workspace?.id !== schema.workspaceId || board.board_kind !== schema.boardKind) {
    throw new Error('Monday board identity does not match the checked-in schema contract');
  }
  const columns = new Map(board.columns.map((column) => [column.id, column.type]));
  const missingColumns = Object.values(schema.columns).filter((column) => !columns.has(column.id));
  const wrongColumns = Object.values(schema.columns).filter((column) => columns.has(column.id) && columns.get(column.id) !== column.type);
  const currentRequired = new Set(data.validations.required_column_ids);
  const expectedRequired = new Set(schema.requiredColumnIds);
  return {
    missingColumns,
    wrongColumns,
    removeRequired: [...currentRequired].filter((id) => !expectedRequired.has(id)),
    addRequired: [...expectedRequired].filter((id) => !currentRequired.has(id)),
    fingerprint: fingerprint(data.validations)
  };
}

async function applyPlan(changes) {
  if (changes.wrongColumns.length) throw new Error('Refusing destructive column replacement');
  for (const column of changes.missingColumns) {
    await request(
      'mutation CreateColumn($boardId: ID!, $columnId: String!, $title: String!, $type: ColumnType!) { create_column(board_id: $boardId, id: $columnId, title: $title, column_type: $type) { id type } }',
      { boardId: schema.boardId, columnId: column.id, title: column.title, type: column.type }
    );
  }
  for (const columnId of changes.removeRequired) {
    await request(
      'mutation RemoveRequired($boardId: ID!, $columnId: String!) { remove_required_column(id: $boardId, column_id: $columnId, type: board) { required_column_ids } }',
      { boardId: schema.boardId, columnId }
    );
  }
  for (const columnId of changes.addRequired) {
    await request(
      'mutation AddRequired($boardId: ID!, $columnId: String!) { add_required_column(id: $boardId, column_id: $columnId, type: board) { required_column_ids } }',
      { boardId: schema.boardId, columnId }
    );
  }
}

async function runSparseCanaries() {
  const createdItemIds = [];
  const prefix = `balance-assist-schema-canary-${randomUUID()}`;
  const create = async (suffix, values) => {
    const data = await request(
      'mutation CreateCanary($boardId: ID!, $itemName: String!, $columnValues: JSON!) { create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id } }',
      { boardId: schema.boardId, itemName: `${prefix}-${suffix}`, columnValues: JSON.stringify(values) }
    );
    const itemId = data.create_item?.id;
    if (!itemId) throw new Error('Monday sparse canary did not return an item ID');
    createdItemIds.push(itemId);
  };

  try {
    await create('name-only', {
      crm_record_id: `canary-${randomUUID()}`,
      qual_status: { index: schema.statusLabelIds.qualification_status.needs_review },
      contact_name: 'Schema Canary'
    });
    await create('email-only', {
      crm_record_id: `canary-${randomUUID()}`,
      qual_status: { index: schema.statusLabelIds.qualification_status.needs_review },
      contact_email: { email: `canary-${randomUUID()}@example.invalid`, text: 'Schema Canary' }
    });
  } finally {
    await Promise.all(createdItemIds.map((itemId) => request(
      'mutation DeleteCanary($itemId: ID!) { delete_item(item_id: $itemId) { id } }',
      { itemId }
    )));
  }
}

const initial = plan(await inspect());
if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', missingColumnIds: initial.missingColumns.map((column) => column.id), wrongColumnIds: initial.wrongColumns.map((column) => column.id), removeRequired: initial.removeRequired, addRequired: initial.addRequired, validationsFingerprint: initial.fingerprint }));
  process.exitCode = initial.missingColumns.length || initial.wrongColumns.length || initial.removeRequired.length || initial.addRequired.length || initial.fingerprint !== schema.validationsFingerprint ? 1 : 0;
} else {
  await applyPlan(initial);
  const final = plan(await inspect());
  if (final.missingColumns.length || final.wrongColumns.length || final.removeRequired.length || final.addRequired.length || final.fingerprint !== schema.validationsFingerprint) {
    throw new Error('Monday schema did not converge to the checked-in contract');
  }
  await runSparseCanaries();
  console.log(JSON.stringify({ mode: 'apply', status: 'converged', validationsFingerprint: final.fingerprint, sparseCanaries: 'passed' }));
}
