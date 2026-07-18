// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Workflow = {
  on?: { schedule?: Array<{ cron?: string }>; workflow_dispatch?: unknown };
  permissions?: Record<string, unknown>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
};

describe('Monday scheduler workflows', () => {
  it('runs dispatch every five minutes and records a heartbeat only after success', async () => {
    const source = await readFile(resolve(process.cwd(), '.github/workflows/monday-dispatch.yml'), 'utf8');
    const workflow = parse(source) as Workflow;

    expect(workflow.on).toEqual({ schedule: [{ cron: '*/5 * * * *' }], workflow_dispatch: null });
    expect(workflow.permissions).toEqual({});
    expect(workflow.concurrency).toEqual({ group: 'monday-dispatch', 'cancel-in-progress': false });
    expect(source).toContain('/api/internal/monday-dispatch');
    expect(source).toContain('/api/internal/scheduler-heartbeat');
    expect(source.indexOf('/api/internal/monday-dispatch')).toBeLessThan(source.indexOf('/api/internal/scheduler-heartbeat'));
    expect(source).toContain('"worker":"monday-dispatch"');
    expect(source).toContain('--max-time 30');
    expect(source).toContain('curl --fail');
    expect(source).toContain('test "$PRODUCTION_URL" = "https://balance-assist.vercel.app"');
  });

  it('runs lifecycle daily and records a heartbeat only after success', async () => {
    const source = await readFile(resolve(process.cwd(), '.github/workflows/monday-lifecycle.yml'), 'utf8');
    const workflow = parse(source) as Workflow;

    expect(workflow.on).toEqual({ schedule: [{ cron: '17 0 * * *' }], workflow_dispatch: null });
    expect(workflow.permissions).toEqual({});
    expect(workflow.concurrency).toEqual({ group: 'monday-lifecycle', 'cancel-in-progress': false });
    expect(source).toContain('/api/internal/monday-lifecycle');
    expect(source).toContain('/api/internal/scheduler-heartbeat');
    expect(source.indexOf('/api/internal/monday-lifecycle')).toBeLessThan(source.indexOf('/api/internal/scheduler-heartbeat'));
    expect(source).toContain('"worker":"monday-lifecycle"');
    expect(source).toContain('--max-time 30');
    expect(source).toContain('curl --fail');
    expect(source).toContain('test "$PRODUCTION_URL" = "https://balance-assist.vercel.app"');
  });

  it('runs reconciliation weekly and records a heartbeat only after success', async () => {
    const source = await readFile(resolve(process.cwd(), '.github/workflows/monday-reconcile.yml'), 'utf8');
    const workflow = parse(source) as Workflow;

    expect(workflow.on).toEqual({ schedule: [{ cron: '23 2 * * 1' }], workflow_dispatch: null });
    expect(workflow.permissions).toEqual({});
    expect(workflow.concurrency).toEqual({ group: 'monday-reconcile', 'cancel-in-progress': false });
    expect(source).toContain('/api/internal/monday-reconcile');
    expect(source).toContain('/api/internal/scheduler-heartbeat');
    expect(source.indexOf('/api/internal/monday-reconcile')).toBeLessThan(source.indexOf('/api/internal/scheduler-heartbeat'));
    expect(source).toContain('"worker":"monday-reconcile"');
    expect(source).toContain('--max-time 30');
    expect(source).toContain('curl --fail');
    expect(source).toContain('test "$PRODUCTION_URL" = "https://balance-assist.vercel.app"');
  });
});
