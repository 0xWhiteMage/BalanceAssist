import { createHash } from 'node:crypto';

import schema from '../../config/monday-crm-schema.json';
import { getMondayConfig } from './config';
import { MondayOAuthError, refreshMondayAccessToken, resolveMondayAccessToken } from './oauth';

export type MondayFailureCode =
  | 'monday_auth_failed'
  | 'monday_permission_denied'
  | 'monday_rate_limited'
  | 'monday_schema_drift'
  | 'monday_payload_invalid'
  | 'monday_temporary_failure'
  | 'monday_provider_idempotency_conflict'
  | 'monday_delivery_unknown'
  | 'monday_duplicate_key_conflict';

export class MondayClientError extends Error {
  constructor(
    public readonly code: MondayFailureCode,
    public readonly retryable: boolean,
    public readonly metadata: MondayResponseMetadata = {},
  ) {
    super(`Monday request failed: ${code}`);
    this.name = 'MondayClientError';
  }

  get retryAfterSeconds() {
    return this.metadata.retryAfterSeconds;
  }
}

export type MondayResponseMetadata = {
  requestId?: string;
  retryAfterSeconds?: number;
  rateLimit?: string;
  rateLimitPolicy?: string;
  apiVersion?: string;
  idempotencyReplayed?: boolean;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Environment = Record<string, string | undefined>;
type ExpectedSchema = typeof schema;
type MondayConnection = { token: string; boardId: string; apiVersion: '2026-07' };
type MondayLane = 'upsert' | 'cleanup';

const endpoint = 'https://api.monday.com/v2';

function metadata(response: Response, body: unknown): MondayResponseMetadata {
  const extensions = body && typeof body === 'object' ? (body as { extensions?: unknown }).extensions : null;
  const errorExtensions = body && typeof body === 'object' && Array.isArray((body as { errors?: unknown }).errors)
    ? ((body as { errors: Array<{ extensions?: unknown }> }).errors
      .map((error) => error.extensions)
      .find((extensions) => extensions && typeof extensions === 'object' && typeof (extensions as { request_id?: unknown }).request_id === 'string') ?? null)
    : null;
  const requestId = [extensions, errorExtensions].find((value) => value && typeof value === 'object' && typeof (value as { request_id?: unknown }).request_id === 'string') as { request_id?: string } | undefined;
  const retryAfter = response.headers.get('Retry-After');
  const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
  return {
    requestId: requestId?.request_id,
    retryAfterSeconds,
    rateLimit: response.headers.get('RateLimit') ?? undefined,
    rateLimitPolicy: response.headers.get('RateLimit-Policy') ?? undefined,
    apiVersion: response.headers.get('API-Version') ?? undefined,
    idempotencyReplayed: response.headers.get('Idempotency-Replayed') === 'true',
  };
}

function failureForStatus(status: number, responseMetadata: MondayResponseMetadata, mutation: boolean): MondayClientError {
  if (status === 401) return new MondayClientError('monday_auth_failed', false, responseMetadata);
  if (status === 403) return new MondayClientError('monday_permission_denied', false, responseMetadata);
  if (status === 409) return new MondayClientError(mutation ? 'monday_provider_idempotency_conflict' : 'monday_duplicate_key_conflict', mutation, responseMetadata);
  if (status === 422 || status === 400) return new MondayClientError('monday_payload_invalid', false, responseMetadata);
  if (status === 429) return new MondayClientError('monday_rate_limited', true, responseMetadata);
  if (status === 423 || status >= 500) return new MondayClientError('monday_temporary_failure', true, responseMetadata);
  return new MondayClientError('monday_payload_invalid', false, responseMetadata);
}

function failureForGraphql(body: { errors: unknown[] }, responseMetadata: MondayResponseMetadata): MondayClientError {
  const extensionCode = body.errors
    .map((error) => error && typeof error === 'object' ? (error as { extensions?: { code?: unknown } }).extensions?.code : undefined)
    .find((code): code is string => typeof code === 'string')?.toLowerCase() ?? '';
  if (extensionCode.includes('auth')) return new MondayClientError('monday_auth_failed', false, responseMetadata);
  if (extensionCode.includes('permission') || extensionCode.includes('forbidden')) return new MondayClientError('monday_permission_denied', false, responseMetadata);
  if (extensionCode.includes('rate')) return new MondayClientError('monday_rate_limited', true, responseMetadata);
  if (extensionCode.includes('schema')) return new MondayClientError('monday_schema_drift', false, responseMetadata);
  if (extensionCode.includes('invalid') || extensionCode.includes('validation')) return new MondayClientError('monday_payload_invalid', false, responseMetadata);
  return new MondayClientError('monday_payload_invalid', false, responseMetadata);
}

async function requireConnection(environment: Environment, lane?: MondayLane, forceRefresh = false): Promise<MondayConnection> {
  const config = getMondayConfig(environment);
  if (lane === 'upsert' && !config.upsertEnabled || lane === 'cleanup' && !config.cleanupEnabled) {
    throw new MondayClientError('monday_permission_denied', false);
  }
  if (!config.authMode || !config.boardId || !config.apiVersion) {
    throw new MondayClientError('monday_auth_failed', false);
  }
  if (config.boardId !== schema.boardId) throw new MondayClientError('monday_schema_drift', false);
  try {
    const token = await (forceRefresh ? refreshMondayAccessToken : resolveMondayAccessToken)({ environment });
    return { token, boardId: config.boardId, apiVersion: config.apiVersion };
  } catch (error) {
    if (error instanceof MondayOAuthError && error.retryable) {
      throw new MondayClientError('monday_temporary_failure', true);
    }
    throw new MondayClientError('monday_auth_failed', false);
  }
}

async function request(
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
  environment: Environment = process.env,
  idempotencyKey?: string,
  lane?: MondayLane,
): Promise<{ data: Record<string, unknown>; metadata: MondayResponseMetadata }> {
  let config = await requireConnection(environment, lane);
  let response: Response | undefined;
  let body: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: config.token,
          'API-Version': '2026-07',
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new MondayClientError('monday_temporary_failure', true);
    }
    body = await response.json().catch(() => null);
    if (response.status !== 401 || attempt === 1) break;
    config = await requireConnection(environment, lane, true);
  }
  if (!response) throw new MondayClientError('monday_temporary_failure', true);
  const responseMetadata = metadata(response, body);
  if (!response.ok) throw failureForStatus(response.status, responseMetadata, Boolean(idempotencyKey));
  if (!body || typeof body !== 'object') throw new MondayClientError('monday_temporary_failure', true, responseMetadata);
  const graph = body as { data?: unknown; errors?: unknown };
  if (Array.isArray(graph.errors) && graph.errors.length > 0) throw failureForGraphql(graph as { errors: unknown[] }, responseMetadata);
  if (graph.data === null || !graph.data || typeof graph.data !== 'object') throw new MondayClientError('monday_temporary_failure', true, responseMetadata);
  return { data: graph.data as Record<string, unknown>, metadata: responseMetadata };
}

function itemsFrom(value: unknown) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
    throw new MondayClientError('monday_temporary_failure', true);
  }
  return (value as { items: unknown[] }).items;
}

export async function findItemsByCrmRecordId(crmRecordId: string, fetchImpl?: FetchLike, environment?: Environment) {
  const result = await request(
    'query FindItems($boardId: ID!, $columns: [ItemsPageByColumnValuesQuery!]!) { items_page_by_column_values(board_id: $boardId, columns: $columns, limit: 2) { items { id } } }',
    { boardId: schema.boardId, columns: [{ column_id: schema.columns.crm_record_id.id, column_values: [crmRecordId] }] }, fetchImpl, environment,
  );
  const items = itemsFrom(result.data.items_page_by_column_values);
  if (items.length > 1) throw new MondayClientError('monday_duplicate_key_conflict', false, result.metadata);
  if (items.some((item) => !item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string' || !(item as { id: string }).id)) {
    throw new MondayClientError('monday_temporary_failure', true, result.metadata);
  }
  return { items: items as Array<{ id: string }>, metadata: result.metadata };
}

export async function getMondayItemById(itemId: string, fetchImpl?: FetchLike, environment?: Environment) {
  const result = await request(
    'query GetItem($itemIds: [ID!], $columnIds: [String!]) { items(ids: $itemIds, exclude_nonactive: false) { id name state board { id } column_values(ids: $columnIds) { id text } } }',
    { itemIds: [itemId], columnIds: schema.sourceOwnedColumns.map((column) => schema.columns[column as keyof typeof schema.columns].id) }, fetchImpl, environment,
  );
  const items = itemsFrom({ items: result.data.items });
  if (items.length !== 1) throw new MondayClientError('monday_temporary_failure', true, result.metadata);
  const item = items[0] as { id?: unknown; name?: unknown; state?: unknown; board?: { id?: unknown }; column_values?: unknown };
  const key = Array.isArray(item.column_values) ? item.column_values.find((column) => (column as { id?: unknown }).id === schema.columns.crm_record_id.id) as { text?: unknown } | undefined : undefined;
  if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.state !== 'string' || typeof item.board?.id !== 'string' || typeof key?.text !== 'string') throw new MondayClientError('monday_temporary_failure', true, result.metadata);
  const sourceColumnTexts = (item.column_values as Array<{ id?: unknown; text?: unknown }>).filter((column) => column.id !== schema.columns.crm_record_id.id).map((column) => column.text);
  if (sourceColumnTexts.some((text) => typeof text !== 'string')) throw new MondayClientError('monday_temporary_failure', true, result.metadata);
  return { id: item.id, name: item.name, state: item.state, boardId: item.board.id, crmRecordId: key.text, sourceColumnTexts: sourceColumnTexts as string[], metadata: result.metadata };
}

export async function scanMondayBoardPage(cursor: string | null, fetchImpl?: FetchLike, environment?: Environment) {
  const result = await request(
    'query ScanBoard($boardIds: [ID!], $cursor: String, $columnIds: [String!]) { boards(ids: $boardIds) { items_page(limit: 100, cursor: $cursor) { cursor items { id state board { id } column_values(ids: $columnIds) { id text } } } } }',
    { boardIds: [schema.boardId], cursor, columnIds: schema.sourceOwnedColumns.map((column) => schema.columns[column as keyof typeof schema.columns].id) }, fetchImpl, environment,
  );
  const boards = result.data.boards;
  if (!Array.isArray(boards) || boards.length !== 1 || !boards[0] || typeof boards[0] !== 'object') throw new MondayClientError('monday_temporary_failure', true, result.metadata);
  const page = (boards[0] as { items_page?: unknown }).items_page;
  const items = itemsFrom(page);
  const nextCursor = page && typeof page === 'object' ? (page as { cursor?: unknown }).cursor : undefined;
  if (nextCursor !== null && typeof nextCursor !== 'string') throw new MondayClientError('monday_temporary_failure', true, result.metadata);
  const normalizedItems = items.map((value) => {
    const item = value as { id?: unknown; state?: unknown; board?: { id?: unknown }; column_values?: unknown };
    const columns = Array.isArray(item.column_values) ? item.column_values : [];
    const key = columns.find((column) => (column as { id?: unknown }).id === schema.columns.crm_record_id.id) as { text?: unknown } | undefined;
    const sourceColumnTexts = columns
      .filter((column) => (column as { id?: unknown }).id !== schema.columns.crm_record_id.id)
      .map((column) => (column as { text?: unknown }).text);
    if (typeof item.id !== 'string' || typeof item.state !== 'string' || typeof item.board?.id !== 'string' || typeof key?.text !== 'string' || sourceColumnTexts.some((text) => typeof text !== 'string')) {
      throw new MondayClientError('monday_temporary_failure', true, result.metadata);
    }
    return { id: item.id, state: item.state, boardId: item.board.id, crmRecordId: key.text, sourceColumnTexts: sourceColumnTexts as string[] };
  });
  return { items: normalizedItems, cursor: nextCursor, metadata: result.metadata };
}

async function mutate(query: string, variables: Record<string, unknown>, requestKey: string, lane: MondayLane, fetchImpl?: FetchLike, environment?: Environment) {
  const result = await request(query, variables, fetchImpl, environment, requestKey, lane);
  const operation = result.data.operation as { id?: unknown } | undefined;
  if (!operation || typeof operation.id !== 'string' || !operation.id) throw new MondayClientError('monday_payload_invalid', false, result.metadata);
  return { itemId: operation.id, metadata: result.metadata };
}

export function createMondayItem(itemName: string, columnValues: Record<string, unknown>, requestKey: string, fetchImpl?: FetchLike, environment?: Environment) {
  return mutate('mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) { operation: create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id } }', { boardId: schema.boardId, itemName, columnValues: JSON.stringify(columnValues) }, requestKey, 'upsert', fetchImpl, environment);
}

export function updateMondayItem(itemId: string, columnValues: Record<string, unknown>, requestKey: string, fetchImpl?: FetchLike, environment?: Environment) {
  return mutate('mutation UpdateItem($boardId: ID!, $itemId: ID!, $columnValues: JSON!) { operation: change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id } }', { boardId: schema.boardId, itemId, columnValues: JSON.stringify(columnValues) }, requestKey, 'upsert', fetchImpl, environment);
}

export function scrubMondayItem(itemId: string, columnValues: Record<string, unknown>, requestKey: string, fetchImpl?: FetchLike, environment?: Environment) {
  return mutate('mutation ScrubItem($boardId: ID!, $itemId: ID!, $columnValues: JSON!) { operation: change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id } }', { boardId: schema.boardId, itemId, columnValues: JSON.stringify(columnValues) }, requestKey, 'cleanup', fetchImpl, environment);
}

export function renameMondayItem(itemId: string, itemName: string, requestKey: string, fetchImpl?: FetchLike, environment?: Environment) {
  return mutate('mutation RenameItem($itemId: ID!, $itemName: String!) { operation: change_item_name(item_id: $itemId, new_name: $itemName) { id } }', { itemId, itemName }, requestKey, 'cleanup', fetchImpl, environment);
}

export function deleteMondayItem(itemId: string, requestKey: string, fetchImpl?: FetchLike, environment?: Environment) {
  return mutate('mutation DeleteItem($itemId: ID!) { operation: delete_item(item_id: $itemId) { id } }', { itemId }, requestKey, 'cleanup', fetchImpl, environment);
}

function fingerprint(validations: { required_column_ids: string[]; rules?: unknown }) {
  return createHash('sha256').update(JSON.stringify({ required_column_ids: [...validations.required_column_ids].sort(), rules: validations.rules ?? null })).digest('hex');
}

async function attest(expectedSchema: ExpectedSchema, fetchImpl?: FetchLike, environment?: Environment, cleanupOnly = false) {
  const result = await request(
    'query BoardSchema($boardIds: [ID!], $boardId: ID!) { me { account { id } } boards(ids: $boardIds, capabilities: []) { id board_kind workspace { id } capabilities columns { id type settings_str } } validations(id: $boardId, type: board) { required_column_ids rules } }',
    { boardIds: [expectedSchema.boardId], boardId: expectedSchema.boardId }, fetchImpl, environment,
  );
  const board = Array.isArray(result.data.boards) ? result.data.boards[0] as { id?: unknown; board_kind?: unknown; workspace?: { id?: unknown }; capabilities?: unknown; columns?: unknown } : undefined;
  const accountId = ((result.data.me as { account?: { id?: unknown } } | undefined)?.account?.id);
  const validations = result.data.validations as { required_column_ids?: unknown; rules?: unknown } | undefined;
  const supportsItemNameMutation = Boolean(board && typeof board.capabilities === 'object' && board.capabilities && (board.capabilities as { item_name?: unknown }).item_name === true);
  if (!board || expectedSchema.apiVersion !== '2026-07' || result.metadata.apiVersion && result.metadata.apiVersion !== '2026-07' || accountId !== expectedSchema.accountId || board.id !== expectedSchema.boardId || board.board_kind !== expectedSchema.boardKind || board.workspace?.id !== expectedSchema.workspaceId || !supportsItemNameMutation || !Array.isArray(board.columns) || !Array.isArray(validations?.required_column_ids)) throw new MondayClientError('monday_schema_drift', false, result.metadata);
  const columns = new Map(board.columns.map((column) => [String((column as { id?: unknown }).id), String((column as { type?: unknown }).type)]));
  const required = cleanupOnly
    ? ['crm_record_id', 'contact_name', 'contact_email', 'company', 'project_scope', 'reference_links']
    : expectedSchema.sourceOwnedColumns;
  if (required.some((name) => !expectedSchema.columns[name as keyof typeof expectedSchema.columns] || columns.get(expectedSchema.columns[name as keyof typeof expectedSchema.columns].id) !== expectedSchema.columns[name as keyof typeof expectedSchema.columns].type)) throw new MondayClientError('monday_schema_drift', false, result.metadata);
  if (!cleanupOnly) {
    for (const [columnName, labels] of Object.entries(expectedSchema.statusLabelIds)) {
      if (columnName === 'initial_stage' && Object.keys(labels).length === 0) continue;
      const expectedColumn = expectedSchema.columns[columnName as keyof typeof expectedSchema.columns];
      const actualColumn = (board.columns as Array<{ id?: unknown; settings_str?: unknown }>).find((column) => column.id === expectedColumn?.id);
      let actualLabels: Record<string, unknown>;
      try {
        actualLabels = actualColumn && typeof actualColumn.settings_str === 'string'
          ? JSON.parse(actualColumn.settings_str).labels
          : {};
      } catch {
        actualLabels = {};
      }
      const expectedTexts = expectedSchema.statusLabelTexts[columnName as keyof typeof expectedSchema.statusLabelTexts];
      if (!expectedColumn || !actualLabels || !expectedTexts || Object.values(labels).some((labelId) => typeof labelId !== 'number' || actualLabels[String(labelId)] !== expectedTexts[String(labelId) as keyof typeof expectedTexts])) {
        throw new MondayClientError('monday_schema_drift', false, result.metadata);
      }
    }
  }
  const requiredColumnIds = validations.required_column_ids as string[];
  if (!cleanupOnly && (!expectedSchema.requiredColumnIds.every((id) => requiredColumnIds.includes(id)) || fingerprint(validations as { required_column_ids: string[]; rules?: unknown }) !== expectedSchema.validationsFingerprint)) throw new MondayClientError('monday_schema_drift', false, result.metadata);
  return { fingerprint: fingerprint(validations as { required_column_ids: string[]; rules?: unknown }), metadata: result.metadata };
}

export function verifyMondaySchema(expectedSchema: ExpectedSchema, fetchImpl?: FetchLike, environment?: Environment) {
  return attest(expectedSchema, fetchImpl, environment);
}

export function verifyMondayCleanupSchema(expectedSchema: ExpectedSchema, fetchImpl?: FetchLike, environment?: Environment) {
  return attest(expectedSchema, fetchImpl, environment, true);
}
