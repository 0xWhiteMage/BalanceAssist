// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { HANDOFF_SEND_TIMEOUT_MS, TOPIC_CREATE_TIMEOUT_MS } from '@/lib/telegram';

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
      run: expect.stringContaining('"${PRODUCTION_URL}/api/internal/handoff-dispatch"')
    });
    expect(step?.run).toContain('"${PRODUCTION_URL}/api/internal/scheduler-heartbeat"');
    expect(step?.run).toContain("--data '{\"worker\":\"handoff-dispatch\"}'");
    expect(step?.run).not.toContain('secrets.');
    expect(step?.env?.CRON_SECRET).toBe('${{ secrets.CRON_SECRET }}');
  });

  it('keeps the dispatch time budget below its HTTP and workflow limits', async () => {
    const workflowSource = await readFile(resolve(process.cwd(), '.github/workflows/handoff-dispatch.yml'), 'utf8');
    const routeSource = await readFile(resolve(process.cwd(), 'app/api/internal/handoff-dispatch/route.ts'), 'utf8');
    const telegramSource = await readFile(resolve(process.cwd(), 'lib/telegram.ts'), 'utf8');
    const workflow = parse(workflowSource) as Workflow;
    const dispatch = workflow.jobs?.dispatch;
    const step = dispatch?.steps?.find(({ name }) => name === 'Dispatch pending handoffs');
    const maxTimes = [...(step?.run ?? '').matchAll(/--max-time (\d+)/g)].map((match) => Number(match[1]));
    const batchSize = Number(routeSource.match(/HANDOFF_DISPATCH_BATCH_SIZE = (\d+)/)?.[1]);
    const dispatchHttpTimeoutMs = maxTimes[0] * 1_000;
    const heartbeatTimeoutMs = maxTimes[1] * 1_000;
    const workflowTimeoutMs = (dispatch?.['timeout-minutes'] ?? 0) * 60_000;
    const cleanupTimeoutMs = Number(telegramSource.match(/TOPIC_CLEANUP_TIMEOUT_MS = ([\d_]+)/)?.[1]?.replaceAll('_', ''));

    expect(batchSize).toBe(2);
    expect(HANDOFF_SEND_TIMEOUT_MS).toBe(10_000);
    expect(TOPIC_CREATE_TIMEOUT_MS).toBe(10_000);
    expect(cleanupTimeoutMs).toBe(10_000);
    expect(maxTimes).toEqual([80, 15]);
    expect(batchSize * (HANDOFF_SEND_TIMEOUT_MS + TOPIC_CREATE_TIMEOUT_MS + cleanupTimeoutMs)).toBeLessThanOrEqual(dispatchHttpTimeoutMs - 20_000);
    expect(dispatchHttpTimeoutMs + heartbeatTimeoutMs).toBeLessThan(workflowTimeoutMs);
  });

  it('monitors scheduler health on the existing five-minute cadence and fails closed', async () => {
    const source = await readFile(resolve(process.cwd(), '.github/workflows/scheduler-health.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const monitor = workflow.jobs?.monitor;
    const step = monitor?.steps?.find(({ name }) => name === 'Fail alert-ready when scheduler work is overdue');

    expect(workflow.on?.schedule).toEqual([{ cron: '*/5 * * * *' }]);
    expect(workflow.on?.workflow_dispatch).toEqual(null);
    expect(workflow.permissions).toEqual({});
    expect(workflow.concurrency).toEqual({ group: 'scheduler-health', 'cancel-in-progress': false });
    expect(step?.run).toContain('test -n "$PRODUCTION_URL"');
    expect(step?.run).toContain('test -n "$CRON_SECRET"');
    expect(step?.run).toContain('/api/internal/scheduler-health');
    expect(step?.run).not.toContain('|| true');
    expect(step?.run).not.toContain('secrets.');
  });
});
