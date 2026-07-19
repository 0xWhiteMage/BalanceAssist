import { describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';

const { resolveMondayAccessToken, refreshMondayAccessToken } = vi.hoisted(() => ({
  resolveMondayAccessToken: vi.fn(async () => 'test-access-token'),
  refreshMondayAccessToken: vi.fn(async () => 'refreshed-access-token'),
}));

vi.mock('../../lib/monday/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/monday/oauth')>();
  return { ...actual, resolveMondayAccessToken, refreshMondayAccessToken };
});

import schema from '../../config/monday-crm-schema.json';
import {
  MondayClientError,
  createMondayItem,
  deleteMondayItem,
  findItemsByCrmRecordId,
  getMondayItemById,
  renameMondayItem,
  scanMondayBoardPage,
  updateMondayItem,
  verifyMondayCleanupSchema,
  verifyMondaySchema,
} from '../../lib/monday/client';
import { getMondayConfig } from '../../lib/monday/config';

const env = {
  MONDAY_OAUTH_CLIENT_ID: 'client-id',
  MONDAY_OAUTH_CLIENT_SECRET: 'client-secret',
  MONDAY_OAUTH_REDIRECT_URI: 'https://example.com/api/internal/monday-oauth/callback',
  MONDAY_BOARD_ID: schema.boardId,
  MONDAY_API_VERSION: '2026-07',
  MONDAY_UPSERT_ENABLED: 'false',
  MONDAY_CLEANUP_ENABLED: 'false',
  MONDAY_AUTH_MODE: 'oauth_2_1',
  MONDAY_AUTH_APPROVAL_REF: '',
};

const liveStatusLabelTexts = {
  qualification_status: { 0: 'Needs Review', 1: 'Qualified', 2: 'Unqualified', 17: 'Misfit' },
  recommended_next_step: { 0: 'Manual review', 4: 'Human follow-up', 5: 'Redirect', 7: 'Book a call' },
  service: { 4: 'Event & experience content', 5: 'Media asset adaptation', 7: 'Production', 14: 'Generative AI', 17: 'Not sure yet', 109: 'Post-production', 152: 'Design direction' },
  budget: { 1: '150k+', 6: 'Under 20k', 9: '50k–150k', 15: '20k–50k', 17: 'Not sure yet' },
  source_channel: { 7: 'Balance Assist' },
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function fetchReturning(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(response(body, status, headers));
}

describe('Monday configuration', () => {
  test('fails closed if enabled lanes lack approved OAuth evidence', () => {
    expect(() => getMondayConfig({ ...env, MONDAY_UPSERT_ENABLED: 'true' })).toThrow('approval');
    expect(() => getMondayConfig({ ...env, MONDAY_UPSERT_ENABLED: 'true', MONDAY_AUTH_MODE: 'service_token' }, 'approval')).toThrow('OAuth 2.1');
    expect(() => getMondayConfig({ ...env, MONDAY_CLEANUP_ENABLED: 'yes' })).toThrow('exactly');
    expect(getMondayConfig(env)).not.toHaveProperty('token');
  });

  test('checks in the live label text for every projected status ID', () => {
    expect(schema).toMatchObject({ statusLabelTexts: liveStatusLabelTexts });
  });

  test('allows cleanup to be enabled independently once approval evidence matches', () => {
    expect(() => getMondayConfig({
      ...env,
      MONDAY_CLEANUP_ENABLED: 'true',
      MONDAY_AUTH_APPROVAL_REF: 'security-exception-2026-07-15',
    }, 'security-exception-2026-07-15')).not.toThrow();
  });

  test.each([
    [true, false],
    [false, true],
    [true, true],
    [false, false],
  ])('preserves explicit upsert=%s cleanup=%s lane combinations', (upsertEnabled, cleanupEnabled) => {
    const config = getMondayConfig({
      ...env,
      MONDAY_UPSERT_ENABLED: String(upsertEnabled),
      MONDAY_CLEANUP_ENABLED: String(cleanupEnabled),
      MONDAY_AUTH_APPROVAL_REF: 'approval',
    }, 'approval');
    expect(config).toMatchObject({ upsertEnabled, cleanupEnabled });
  });
});

describe('Monday GraphQL client', () => {
  test('acquires OAuth tokens asynchronously and uses raw Authorization, API 2026-07, and a ten-second timeout', async () => {
    const fetchMock = fetchReturning({ data: { items_page_by_column_values: { items: [] } } });

    await findItemsByCrmRecordId('crm-1', fetchMock, env);

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(resolveMondayAccessToken).toHaveBeenCalledWith({ environment: env });
    expect(options.headers).toMatchObject({ Authorization: 'test-access-token', 'API-Version': '2026-07' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test('aborts an unresolved provider request after ten seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    }));

    const pending = findItemsByCrmRecordId('crm-1', fetchMock, env);
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toMatchObject({ code: 'monday_temporary_failure' });
    vi.useRealTimers();
  });

  test('forces one token refresh and retries once after a 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: {} }, 401))
      .mockResolvedValueOnce(response({ data: { items_page_by_column_values: { items: [] } } }));

    await expect(findItemsByCrmRecordId('crm-1', fetchMock, env)).resolves.toMatchObject({ items: [] });
    expect(refreshMondayAccessToken).toHaveBeenCalledWith({ environment: env });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'refreshed-access-token' });
  });

  test('uses the root-level modern column filter lookup limited to two results', async () => {
    const fetchMock = fetchReturning({ data: { items_page_by_column_values: { items: [] } } });

    await findItemsByCrmRecordId('crm-1', fetchMock, env);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.query).toBe('query FindItems($boardId: ID!, $columns: [ItemsPageByColumnValuesQuery!]!) { items_page_by_column_values(board_id: $boardId, columns: $columns, limit: 2) { items { id } } }');
    expect(body.variables).toEqual({
      boardId: schema.boardId,
      columns: [{ column_id: schema.columns.crm_record_id.id, column_values: ['crm-1'] }],
    });
    expect(body.query).not.toContain('column_id: $columnId');
    expect(body.query).not.toContain('column_value: $crmRecordId');
    expect(body.query).not.toContain('boards(ids:');
  });

  test.each([
    [{ errors: [{ message: 'nope' }], data: {} }, 200, 'monday_payload_invalid'],
    [{ data: null }, 200, 'monday_temporary_failure'],
    [{ data: {} }, 401, 'monday_auth_failed'],
    [{ data: {} }, 400, 'monday_payload_invalid'],
    [{ data: {} }, 403, 'monday_permission_denied'],
    [{ data: {} }, 422, 'monday_payload_invalid'],
    [{ data: {} }, 423, 'monday_temporary_failure'],
    [{ data: {} }, 429, 'monday_rate_limited'],
    [{ data: {} }, 500, 'monday_temporary_failure'],
  ])('categorizes unsafe provider responses (%i)', async (body, status, code) => {
    await expect(findItemsByCrmRecordId('crm-1', fetchReturning(body, status), env)).rejects.toMatchObject({ code });
  });

  test('parses safe request and rate metadata', async () => {
    const fetchMock = fetchReturning(
      { data: { items_page_by_column_values: { items: [] } }, extensions: { request_id: 'root-request' } },
      200,
      { 'Retry-After': '3', RateLimit: '4', 'RateLimit-Policy': '5;w=60', 'API-Version': '2026-07', 'Idempotency-Replayed': 'true' },
    );

    const result = await findItemsByCrmRecordId('crm-1', fetchMock, env);

    expect(result.metadata).toEqual(expect.objectContaining({ requestId: 'root-request', retryAfterSeconds: 3, rateLimit: '4', rateLimitPolicy: '5;w=60', apiVersion: '2026-07', idempotencyReplayed: true }));
  });

  test('extracts a request ID from any GraphQL error extension', async () => {
    await expect(findItemsByCrmRecordId('crm-1', fetchReturning({
      errors: [
        { extensions: { code: 'INVALID_QUERY' } },
        { extensions: { request_id: 'error-request' } },
      ],
    }), env)).rejects.toMatchObject({ metadata: { requestId: 'error-request' } });
  });

  test('returns only a validated empty array as absence', async () => {
    await expect(findItemsByCrmRecordId('crm-1', fetchReturning({ data: { items_page_by_column_values: { items: null } } }), env)).rejects.toBeInstanceOf(MondayClientError);
    await expect(findItemsByCrmRecordId('crm-1', fetchReturning({ data: { items_page_by_column_values: { items: [] } } }), env)).resolves.toMatchObject({ items: [] });
  });

  test('gets inactive item identity and scans board pages', async () => {
    const columnValues = schema.sourceOwnedColumns.map((column) => ({
      id: schema.columns[column as keyof typeof schema.columns].id,
      text: column === 'crm_record_id' ? 'crm-1' : '',
    }));
    const getFetch = fetchReturning({ data: { items: [{ id: '42', name: 'crm-1', board: { id: schema.boardId }, state: 'deleted', column_values: columnValues }] } });
    await expect(getMondayItemById('42', getFetch, env)).resolves.toMatchObject({ id: '42', name: 'crm-1', boardId: schema.boardId, state: 'deleted', crmRecordId: 'crm-1', sourceColumnTexts: Array(schema.sourceOwnedColumns.length - 1).fill('') });
    expect(JSON.parse(getFetch.mock.calls[0][1]?.body as string).query).toContain('exclude_nonactive: false');

    const scanFetch = fetchReturning({ data: { boards: [{ items_page: { cursor: 'next', items: [] } }] } });
    await expect(scanMondayBoardPage(null, scanFetch, env)).resolves.toMatchObject({ cursor: 'next', items: [] });
    expect(JSON.parse(scanFetch.mock.calls[0][1]?.body as string).query).toContain('column_values(ids: $columnIds)');
  });

  test('fails closed before provider mutations when their lane is disabled', async () => {
    const createFetch = fetchReturning({ data: { operation: { id: '42' } } });
    await expect(createMondayItem('opaque item', { crm_record_id: 'crm-1' }, 'key-1', createFetch, env)).rejects.toMatchObject({ code: 'monday_permission_denied' });
    expect(createFetch).not.toHaveBeenCalled();

    const updateFetch = fetchReturning({ data: { operation: { id: '42' } } });
    await expect(updateMondayItem('42', { crm_record_id: 'crm-1' }, 'key-2', updateFetch, env)).rejects.toMatchObject({ code: 'monday_permission_denied' });
    expect(updateFetch).not.toHaveBeenCalled();

    const deleteFetch = fetchReturning({ data: { operation: { id: '42' } } });
    await expect(deleteMondayItem('42', 'key-3', deleteFetch, env)).rejects.toMatchObject({ code: 'monday_permission_denied' });
    expect(deleteFetch).not.toHaveBeenCalled();

    const renameFetch = fetchReturning({ data: { operation: { id: '42' } } });
    await expect(renameMondayItem('42', 'opaque-crm-key', 'key-4', renameFetch, env)).rejects.toMatchObject({ code: 'monday_permission_denied' });
    expect(renameFetch).not.toHaveBeenCalled();
  });

  test('keeps duplicate-business-key reads distinct from disabled mutation lanes', async () => {
    const mutationFetch = fetchReturning({ data: {} }, 409, { 'Retry-After': '5' });
    await expect(createMondayItem('opaque item', {}, 'key-1', mutationFetch, env)).rejects.toMatchObject({ code: 'monday_permission_denied' });
    expect(mutationFetch).not.toHaveBeenCalled();
    await expect(findItemsByCrmRecordId('crm-1', fetchReturning({ data: { items_page_by_column_values: { items: [{ id: '1' }, { id: '2' }] } } }), env)).rejects.toMatchObject({ code: 'monday_duplicate_key_conflict' });
  });

  test('attests full and cleanup schema separately using root validations and capabilities', async () => {
    const boardColumns = Object.values(schema.columns).map((column) => ({
      ...column,
      settings_str: JSON.stringify({ labels: (liveStatusLabelTexts as Record<string, Record<number, string>>)[Object.entries(schema.columns).find(([, expected]) => expected.id === column.id)?.[0] ?? ''] ?? {} }),
    }));
    const data = {
      me: { account: { id: schema.accountId } },
      boards: [{ id: schema.boardId, board_kind: schema.boardKind, workspace: { id: schema.workspaceId }, columns: boardColumns, capabilities: { item_name: true } }],
      validations: { required_column_ids: schema.requiredColumnIds, rules: [] },
    };
    const expectedSchema = {
      ...schema,
      validationsFingerprint: createHash('sha256')
        .update(JSON.stringify({ required_column_ids: [...schema.requiredColumnIds].sort(), rules: [] }))
        .digest('hex'),
    };
    const fetchMock = fetchReturning({ data });
    await expect(verifyMondaySchema(expectedSchema, fetchMock, env)).resolves.toMatchObject({ fingerprint: expect.any(String) });
    const query = JSON.parse(fetchMock.mock.calls[0][1]?.body as string).query;
    expect(query).toContain('capabilities: []');
    expect(query).toContain('validations(id: $boardId, type: board)');

    await expect(verifyMondayCleanupSchema(expectedSchema, fetchReturning({ data }), env)).resolves.toMatchObject({ fingerprint: expect.any(String) });

    await expect(verifyMondayCleanupSchema(expectedSchema, fetchReturning({
      data: { ...data, boards: [{ ...data.boards[0], capabilities: { item_name: false } }] },
    }), env)).rejects.toMatchObject({ code: 'monday_schema_drift' });

    const renamedColumns = boardColumns.map((column) => column.id === schema.columns.service.id
      ? { ...column, settings_str: JSON.stringify({ labels: { ...liveStatusLabelTexts.service, 7: 'Renamed service' } }) }
      : column);
    await expect(verifyMondaySchema(expectedSchema, fetchReturning({
      data: { ...data, boards: [{ ...data.boards[0], columns: renamedColumns }] },
    }), env)).rejects.toMatchObject({ code: 'monday_schema_drift' });
  });

  test('does not expose tokens or payload values in failures', async () => {
    try {
      await createMondayItem('private email@example.com', { secret: 'test-access-token' }, 'key-1', fetchReturning({ errors: [{ message: 'private email@example.com test-access-token' }] }), env);
    } catch (error) {
      expect(error).toBeInstanceOf(MondayClientError);
      expect((error as Error).message).not.toContain('test-access-token');
      expect((error as Error).message).not.toContain('email@example.com');
    }
  });
});
