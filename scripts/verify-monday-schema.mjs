import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const schema = JSON.parse(await readFile(resolve(root, 'config/monday-crm-schema.json'), 'utf8'));
const token = process.env.MONDAY_API_TOKEN;
const boardId = process.env.MONDAY_BOARD_ID ?? schema.boardId;
const apiVersion = process.env.MONDAY_API_VERSION ?? schema.apiVersion;

if (!token || boardId !== schema.boardId || apiVersion !== '2026-07') throw new Error('Monday schema verifier requires the checked-in board, API version, and token');

const query = 'query BoardSchema($boardIds: [ID!], $boardId: ID!) { me { account { id } } boards(ids: $boardIds) { id board_kind workspace { id } columns { id type settings_str } } validations(id: $boardId, type: board) { required_column_ids rules } }';
const response = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { Authorization: token, 'API-Version': apiVersion, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { boardIds: [boardId], boardId } }), signal: AbortSignal.timeout(10_000) });
const body = await response.json().catch(() => null);
if (!response.ok || !body?.data || body.errors?.length) throw new Error(`Monday schema verification failed (${response.status})`);
const board = body.data.boards?.[0];
if (body.data.me?.account?.id !== schema.accountId || board?.id !== schema.boardId || board?.board_kind !== schema.boardKind || board?.workspace?.id !== schema.workspaceId) throw new Error('Monday board identity does not match the checked-in contract');
const columns = new Map((board?.columns ?? []).map((column) => [column.id, column.type]));
const mismatchedColumns = Object.values(schema.columns).filter((column) => columns.get(column.id) !== column.type).map((column) => ({ id: column.id, expectedType: column.type, actualType: columns.get(column.id) ?? null }));
const fingerprint = createHash('sha256').update(JSON.stringify({ required_column_ids: [...(body.data.validations?.required_column_ids ?? [])].sort(), rules: body.data.validations?.rules ?? null })).digest('hex');
const labelsMatch = Object.entries(schema.statusLabelIds).every(([columnName, labels]) => {
  if (columnName === 'initial_stage' && Object.keys(labels).length === 0) return true;
  const column = board.columns.find((candidate) => candidate.id === schema.columns[columnName]?.id);
  try {
    const actualLabels = JSON.parse(column?.settings_str ?? '{}').labels ?? {};
    return Object.values(labels).every((labelId) => typeof labelId === 'number' && actualLabels[String(labelId)] === schema.statusLabelTexts[columnName]?.[String(labelId)]);
  } catch {
    return false;
  }
});
console.log(JSON.stringify({ boardId, apiVersion: response.headers.get('API-Version') ?? apiVersion, fingerprint, mismatchedColumns }));
process.exitCode = mismatchedColumns.length || !labelsMatch || fingerprint !== schema.validationsFingerprint ? 1 : 0;
