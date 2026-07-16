// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Monday schema verifier', () => {
  test('uses supported board fields while retaining the schema contract checks', async () => {
    const source = await readFile(resolve(root, 'scripts/verify-monday-schema.mjs'), 'utf8');

    expect(source).toContain('me { account { id } }');
    expect(source).toContain('boards(ids: $boardIds) { id board_kind workspace { id } columns { id type settings_str } }');
    expect(source).toContain('validations(id: $boardId, type: board) { required_column_ids rules }');
    expect(source).toContain('body.data.me?.account?.id !== schema.accountId');
    expect(source).toContain('board?.board_kind !== schema.boardKind');
    expect(source).toContain('board?.workspace?.id !== schema.workspaceId');
    expect(source).toContain("createHash('sha256')");
    expect(source).toContain('fingerprint !== schema.validationsFingerprint');
    expect(source).not.toContain('capabilities');
  });
});
