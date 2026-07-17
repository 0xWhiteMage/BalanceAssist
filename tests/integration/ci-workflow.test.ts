// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { uses?: string; run?: string };
type Job = { needs?: string[]; env?: Record<string, string>; steps?: Step[] };
type Workflow = { permissions?: Record<string, string>; jobs?: Record<string, Job> };

describe('CI workflow action supply chain', () => {
  it('uses only reviewed immutable action commits', async () => {
    const source = await readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const actions = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []).flatMap((step) => step.uses ? [step.uses] : []);

    expect(actions).toEqual(expect.arrayContaining([
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
      'supabase/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1',
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
    ]));
    expect(actions).not.toHaveLength(0);
    for (const action of actions) expect(action).toMatch(/^[\w-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('requires every trust-centered release proof before CI can pass', async () => {
    const source = await readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const jobs = workflow.jobs ?? {};
    const commands = (name: string) => (jobs[name]?.steps ?? []).flatMap((step) => step.run ? [step.run] : []);

    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(commands('lint')).toContain('npm run lint');
    expect(commands('typecheck')).toContain('npx tsc --noEmit');
    expect(commands('test')).toContain('npx vitest run');
    expect(commands('database')).toContain('npm run test:supabase');
    expect(jobs.database?.env?.REQUIRE_SUPABASE_RELEASE_PROOF).toBe('1');
    expect(commands('build')).toContain('npm run build');
    expect(commands('e2e')).toContain('npm run test:e2e');
    expect(commands('dependency-audit')).toContain('npm audit --omit=dev --audit-level=high');
    expect(jobs['release-proof']?.needs).toEqual([
      'lint', 'typecheck', 'test', 'database', 'build', 'diff-check', 'e2e', 'dependency-audit'
    ]);
  });
});
