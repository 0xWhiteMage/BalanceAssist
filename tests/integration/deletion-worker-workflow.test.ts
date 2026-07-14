import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

test('deletion worker is scheduled by GitHub every five minutes and records a heartbeat', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deletion-worker.yml'), 'utf8');
  expect(workflow).toContain("cron: '*/5 * * * *'");
  expect(workflow).toContain('/api/internal/deletion-worker');
  expect(workflow).toContain('"worker":"deletion-worker"');
  expect(workflow).not.toMatch(/vercel/i);
});
