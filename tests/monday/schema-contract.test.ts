import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const schemaPath = resolve(process.cwd(), 'config/monday-crm-schema.json');

test('checks in the Monday CRM schema contract', () => {
  expect(existsSync(schemaPath)).toBe(true);
});
