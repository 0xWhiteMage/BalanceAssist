import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const provisionerPath = resolve(process.cwd(), 'scripts/provision-monday-schema.mjs');

test('provides an idempotent Monday schema provisioner', () => {
  expect(existsSync(provisionerPath)).toBe(true);
});

test('uses a scalar board ID for root-level validations', () => {
  const source = readFileSync(provisionerPath, 'utf8');
  expect(source).toContain('query BoardSchema($boardIds: [ID!], $boardId: ID!)');
});

test('runs both sparse contact canaries after applying changes', () => {
  const source = readFileSync(provisionerPath, 'utf8');
  expect(source).toContain('runSparseCanaries');
});
