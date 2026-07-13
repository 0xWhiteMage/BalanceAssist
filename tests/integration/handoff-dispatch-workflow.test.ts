// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Workflow = {
  on?: {
    schedule?: Array<{ cron?: string }>;
    workflow_dispatch?: Record<string, never> | null;
  };
  permissions?: Record<string, never>;
  concurrency?: {
    group?: string;
    'cancel-in-progress'?: boolean;
  };
  jobs?: Record<string, {
    'timeout-minutes'?: number;
    steps?: Array<{
      name?: string;
      shell?: string;
      env?: Record<string, string>;
      run?: string;
    }>;
  }>;
};

describe('handoff dispatch workflow', () => {
  it('uses a safe five-minute authenticated dispatch schedule', async () => {
    const source = await readFile(resolve(process.cwd(), '.github/workflows/handoff-dispatch.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const dispatch = workflow.jobs?.dispatch;
    const step = dispatch?.steps?.find(({ name }) => name === 'Dispatch pending handoffs');

    expect(workflow.on?.schedule).toEqual([{ cron: '*/5 * * * *' }]);
    expect(workflow.on?.workflow_dispatch).toEqual(null);
    expect(workflow.permissions).toEqual({});
    expect(workflow.concurrency).toEqual({ group: 'handoff-dispatch', 'cancel-in-progress': false });
    expect(dispatch?.['timeout-minutes']).toBe(2);
    expect(step).toMatchObject({
      shell: 'bash',
      env: {
        PRODUCTION_URL: '${{ secrets.PRODUCTION_URL }}',
        CRON_SECRET: '${{ secrets.CRON_SECRET }}'
      },
      run: `set -euo pipefail
curl --fail --silent --show-error --max-time 30 --request POST \\
  --header "Authorization: Bearer \${CRON_SECRET}" \\
  "\${PRODUCTION_URL}/api/internal/handoff-dispatch"
`
    });
    expect(step?.run).not.toContain('secrets.');
    expect(step?.env?.CRON_SECRET).toBe('${{ secrets.CRON_SECRET }}');
  });
});
