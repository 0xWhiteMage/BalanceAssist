// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock,
  SESSION_CAPABILITY_COOKIE_NAME: 'session_capability'
}));

import { GET as getDraft, PUT as putDraft } from '@/app/api/projects/[sessionId]/draft/route';
import { POST as postDelete } from '@/app/api/projects/[sessionId]/delete/route';
import { POST as postReset } from '@/app/api/projects/[sessionId]/reset/route';

type SessionRow = {
  id: string;
  draft: Record<string, unknown>;
  draft_version: number;
  status?: string;
};

function createRouteSupabase(session: SessionRow) {
  const state = { ...session };
  const sessionUpdates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const deletionJobs: Array<Record<string, unknown>> = [];

  const supabase = {
    rpc: async (name: string, args: { p_session_id: string; p_expected_draft_version: number; p_fields: Array<{ field: string; value: string; provenance: string }> }) => {
      expect(name).toBe('update_session_draft');
      if (args.p_expected_draft_version !== state.draft_version) {
        return { data: [{ draft: structuredClone(state.draft), draft_version: state.draft_version, conflict: true }], error: null };
      }
      const draft = structuredClone(state.draft) as Record<string, unknown>;
      for (const field of args.p_fields) {
        draft[field.field] = { value: field.provenance === 'cleared' ? '' : field.value, provenance: field.provenance, updatedAt: new Date().toISOString() };
      }
      state.draft = draft;
      state.draft_version += 1;
      return { data: [{ draft: structuredClone(state.draft), draft_version: state.draft_version, conflict: false }], error: null };
    },
    from(table: string) {
      if (table === 'sessions') {
        return {
          select() {
            return {
              eq(column: string, value: string) {
                expect(column).toBe('id');
                expect(value).toBe(state.id);
                return {
                  maybeSingle: async () => ({ data: structuredClone(state), error: null })
                };
              }
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(column: string, value: string) {
                expect(column).toBe('id');
                expect(value).toBe(state.id);
                sessionUpdates.push(payload);
                Object.assign(state, payload);
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }

      if (table === 'events') {
        return {
          insert: async (payload: Record<string, unknown>) => {
            events.push(payload);
            return { error: null };
          }
        };
      }

      if (table === 'deletion_jobs') {
        return {
          upsert(payload: Record<string, unknown>) {
            deletionJobs.push(payload);
            return {
              select() {
                return {
                  single: async () => ({ data: { id: 'job-1', state: 'requested', requested_at: '2026-07-14T00:00:00.000Z', attempts: 0 }, error: null })
                };
              }
            };
          }
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }
  };

  return { supabase, sessionUpdates, events, deletionJobs, state };
}

function authorizedSession(sessionId: string, supabase: unknown) {
  return {
    ok: true as const,
    auth: { sessionId, capability: `${sessionId}.secret` },
    supabase
  };
}

async function callDraftGet(sessionId: string) {
  const req = new Request(`http://localhost/api/projects/${sessionId}/draft`);
  return getDraft(req, { params: Promise.resolve({ sessionId }) });
}

async function callDraftPut(sessionId: string, body: unknown) {
  const req = new Request(`http://localhost/api/projects/${sessionId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return putDraft(req, { params: Promise.resolve({ sessionId }) });
}

async function callDeleteRoute(sessionId: string) {
  const req = new Request(`http://localhost/api/projects/${sessionId}/delete`, {
    method: 'POST'
  });
  return postDelete(req, { params: Promise.resolve({ sessionId }) });
}

async function callResetRoute(sessionId: string) {
  const req = new Request(`http://localhost/api/projects/${sessionId}/reset`, {
    method: 'POST'
  });
  return postReset(req, { params: Promise.resolve({ sessionId }) });
}

describe('draft route', () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
  });

  test('GET returns the persisted canonical draft from the session row', async () => {
    const harness = createRouteSupabase({
      id: 'session-1',
      draft: {
        service: {
          value: 'production',
          provenance: 'confirmed',
          updatedAt: '2026-07-11T10:00:00.000Z'
        }
      },
      draft_version: 4
    });

    requireSessionMock.mockResolvedValue(authorizedSession('session-1', harness.supabase));

    const res = await callDraftGet('session-1');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessionId).toBe('session-1');
    expect(data.fieldCount).toBe(1);
    expect(data.draftVersion).toBe(4);
    expect(data.draft).toEqual(harness.state.draft);
  });

  test('PUT persists merged draft state into sessions.draft and increments draft_version', async () => {
    const harness = createRouteSupabase({
      id: 'session-2',
      draft: {
        service: {
          value: 'production',
          provenance: 'user-stated',
          updatedAt: '2026-07-11T10:00:00.000Z'
        }
      },
      draft_version: 2
    });

    requireSessionMock.mockResolvedValue(authorizedSession('session-2', harness.supabase));

    const res = await callDraftPut('session-2', {
      expectedDraftVersion: 2,
      fields: [
        { field: 'contactName', value: 'Jayden', provenance: 'confirmed' },
        { field: 'service', value: '', provenance: 'cleared' }
      ]
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(harness.sessionUpdates).toHaveLength(0);
    expect(harness.state.draft_version).toBe(3);
    expect(harness.state.draft).toMatchObject({
      service: { value: '', provenance: 'cleared' },
      contactName: { value: 'Jayden', provenance: 'confirmed' }
    });
    expect(data.draftVersion).toBe(3);
    expect(data.draft.contactName.value).toBe('Jayden');
    expect(data.draft.service.provenance).toBe('cleared');
  });

  test('PUT rejects stale draft updates when the expected version does not match', async () => {
    const harness = createRouteSupabase({
      id: 'session-stale',
      draft: {
        contactName: {
          value: 'Current',
          provenance: 'confirmed',
          updatedAt: '2026-07-11T10:00:00.000Z'
        }
      },
      draft_version: 4
    });

    requireSessionMock.mockResolvedValue(authorizedSession('session-stale', harness.supabase));

    const res = await callDraftPut('session-stale', {
      expectedDraftVersion: 3,
      fields: [{ field: 'contactName', value: 'Stale write', provenance: 'confirmed' }]
    });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/stale|version/i);
    expect(data.draftVersion).toBe(4);
    expect(harness.sessionUpdates).toHaveLength(0);
  });

  test('rejects access to a different authenticated session', async () => {
    const harness = createRouteSupabase({
      id: 'session-3',
      draft: {},
      draft_version: 0
    });

    requireSessionMock.mockResolvedValue(authorizedSession('another-session', harness.supabase));

    const res = await callDraftPut('session-3', {
      fields: [{ field: 'service', value: 'production', provenance: 'user-stated' }]
    });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/session/i);
    expect(harness.sessionUpdates).toHaveLength(0);
  });
});

describe('delete route', () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
  });

  test('records a durable deletion request and returns an honest status message', async () => {
    const harness = createRouteSupabase({
      id: 'session-4',
      draft: {},
      draft_version: 0,
      status: 'open'
    });

    requireSessionMock.mockResolvedValue(authorizedSession('session-4', harness.supabase));

    const res = await callDeleteRoute('session-4');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.sessionId).toBe('session-4');
    expect(data.jobId).toBe('job-1');
    expect(data.deleted).toBe(false);
    expect(data.status).toBe('requested');
    expect(data.message).toMatch(/recorded your deletion request/i);
    expect(data.message).not.toMatch(/has been deleted/i);
    expect(data.requestedAt).toBeTruthy();
    expect(harness.deletionJobs).toEqual([{ session_id: 'session-4', state: 'requested' }]);
    expect(harness.events).toHaveLength(0);
  });

  test('rejects deletion requests for a different authenticated session', async () => {
    const harness = createRouteSupabase({
      id: 'session-5',
      draft: {},
      draft_version: 0
    });

    requireSessionMock.mockResolvedValue(authorizedSession('other-session', harness.supabase));

    const res = await callDeleteRoute('session-5');
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/session/i);
    expect(harness.events).toHaveLength(0);
  });

  test('reset clears canonical draft state and revokes the session capability', async () => {
    const harness = createRouteSupabase({
      id: 'session-6',
      draft: {
        service: {
          value: 'production',
          provenance: 'confirmed',
          updatedAt: '2026-07-11T10:00:00.000Z'
        }
      },
      draft_version: 2,
      status: 'completed'
    });

    requireSessionMock.mockResolvedValue(authorizedSession('session-6', harness.supabase));

    const res = await callResetRoute('session-6');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.reset).toBe(true);
    expect(harness.sessionUpdates).toHaveLength(1);
    expect(harness.sessionUpdates[0]).toMatchObject({
      draft: {},
      draft_version: 3,
      status: 'open',
      capability_hash: null,
      capability_expires_at: null
    });
    expect(res.headers.get('set-cookie')).toContain('session_capability=;');
  });
});
