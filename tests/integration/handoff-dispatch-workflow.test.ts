// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('handoff dispatch workflow', () => {
  it('uses a safe five-minute authenticated dispatch schedule', async () => {
    const workflow = await readFile(resolve(process.cwd(), '.github/workflows/handoff-dispatch.yml'), 'utf8');

    expect(workflow).toContain('cron: \'*/5 * * * *\'');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('permissions: {}');
    expect(workflow).toContain('concurrency:');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('secrets.PRODUCTION_URL');
    expect(workflow).toContain('Authorization: Bearer ${{ secrets.CRON_SECRET }}');
    expect(workflow).toContain('set -euo pipefail');
    expect(workflow).toContain('--fail');
    expect(workflow).toMatch(/--max-time\s+\d+/);
    expect(workflow).not.toMatch(/CRON_SECRET:\s*[^${\s]/);
  });
});
