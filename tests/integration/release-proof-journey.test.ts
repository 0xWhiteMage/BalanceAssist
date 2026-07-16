// @vitest-environment node

import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installTelegramTransportForTests } from '@/lib/telegram';

const { createServerSupabaseClientMock, hasSupabaseServerConfigMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  hasSupabaseServerConfigMock: vi.fn()
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
  hasSupabaseServerConfig: hasSupabaseServerConfigMock
}));

import { POST as createSession } from '@/app/api/sessions/route';
import { POST as recordConsent } from '@/app/api/projects/[sessionId]/consent/route';
import { PUT as updateDraft } from '@/app/api/projects/[sessionId]/draft/route';
import { POST as finalizeLead } from '@/app/api/leads/finalize/route';
import { POST as dispatchHandoffs } from '@/app/api/internal/handoff-dispatch/route';
import { POST as receiveWebhook } from '@/app/api/telegram/webhook/route';
import { GET as pollMessages } from '@/app/api/telegram/messages/route';

const connectionString = process.env.TEST_DATABASE_URL;
const runId = `release-proof-${randomUUID()}`;
const origin = `https://${runId}.example.test`;
const clientIp = `198.18.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const updateId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1_000_000);
let client: import('pg').Client | undefined;
let telegramServer: ReturnType<typeof createServer> | undefined;
let telegramUrl = '';
let uninstallTelegramTransport: (() => void) | undefined;
const telegramRequests: Array<{ path?: string; body?: Record<string, unknown> }> = [];

function result(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error });
}

function databaseSupabase(client: import('pg').Client) {
  const selectOne = (table: string, columns: string, column: string, value: unknown) => client
    .query(`select ${columns} from public.${table} where ${column} = $1 limit 1`, [value])
    .then(({ rows }) => ({ data: rows[0] ?? null, error: null }));
  const filtered = (table: string, columns: string, filters: Array<[string, unknown]>) => {
    const where = filters.map(([column], index) => `${column} = $${index + 1}`).join(' and ');
    return client.query(`select ${columns} from public.${table} where ${where}`, filters.map(([, value]) => value));
  };
  const table = (name: string) => ({
    insert: (payload: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          const keys = Object.keys(payload);
          const values = keys.map((key) => payload[key]);
          const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
          const inserted = await client.query(
            `insert into public.${name} (${keys.join(', ')}) values (${placeholders}) returning *`, values
          );
          return { data: inserted.rows[0], error: null };
        }
      }),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => client.query(
        `insert into public.${name} (${Object.keys(payload).join(', ')}) values (${Object.keys(payload).map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values(payload)
      ).then(() => resolve({ data: null, error: null }))
    }),
    select: (columns: string) => ({
      eq: (column: string, value: unknown) => ({
        maybeSingle: () => selectOne(name, columns, column, value),
        order: (_order: string, _options: unknown) => filtered(name, columns, [[column, value]]).then(({ rows }) => ({ data: rows, error: null })),
        eq: (nextColumn: string, nextValue: unknown) => ({
          order: () => ({ limit: () => ({ gt: () => result([], null) }) }),
          maybeSingle: () => filtered(name, columns, [[column, value], [nextColumn, nextValue]]).then(({ rows }) => ({ data: rows[0] ?? null, error: null }))
        })
      })
    }),
    update: (payload: Record<string, unknown>) => {
      const update = (filters: Array<[string, unknown]>) => {
        const keys = Object.keys(payload);
        const values = [...Object.values(payload), ...filters.map(([, value]) => value)];
        const sql = `update public.${name} set ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')} where ${filters.map(([column], index) => `${column} = $${keys.length + index + 1}`).join(' and ')}`;
        return {
          then: (resolve: (value: { error: null }) => unknown) => client.query(sql, values).then(() => resolve({ error: null })),
          eq: (column: string, value: unknown) => update([...filters, [column, value]]),
          is: (column: string, value: unknown) => ({
            select: async () => {
              const nullableSql = `${sql} and ${column} is ${value === null ? 'null' : '$' + (values.length + 1)} returning *`;
              const nullableValues = value === null ? values : [...values, value];
              const { rows } = await client.query(nullableSql, nullableValues);
              return { data: rows, error: null };
            }
          }),
          select: () => ({ maybeSingle: () => client.query(`${sql} returning *`, values).then(({ rows }) => ({ data: rows[0] ?? null, error: null })) })
        };
      };
      return { eq: (column: string, value: unknown) => update([[column, value]]) };
    }
  });
  return {
    from(name: string) {
      if (name === 'human_messages') {
        return {
          ...table(name),
          select: (columns: string) => ({
            eq: (column: string, value: unknown) => ({
              eq: (nextColumn: string, nextValue: unknown) => ({
                order: () => ({ limit: () => filtered(name, columns, [[column, value], [nextColumn, nextValue]]).then(({ rows }) => ({ data: rows, error: null })) })
              })
            })
          })
        };
      }
      if (name === 'reference_links' || name === 'uploaded_files') {
        return { select: () => ({ eq: () => ({ is: async () => ({ data: [], error: null }) }) }) };
      }
      return table(name);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const values = Object.values(args).map((value) => Array.isArray(value) ? JSON.stringify(value) : value);
      const call = await client.query(`select * from public.${name}(${Object.keys(args).map((_, index) => `$${index + 1}`).join(', ')})`, values);
      if (name === 'reserve_handoff_send') return { data: Object.values(call.rows[0] ?? {})[0] ?? false, error: null };
      return { data: call.rows, error: null };
    }
  };
}

describe.skipIf(!connectionString)('release proof journey', () => {
  beforeAll(async () => {
    const { Client } = await import('pg');
    client = new Client({ connectionString });
    await client.connect();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockImplementation(() => databaseSupabase(client!));
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-vercel-forwarded-for';
    process.env.ALLOWED_ORIGINS = origin;
    process.env.CRON_SECRET = `${runId}-cron`;
    process.env.TELEGRAM_BOT_TOKEN = `${runId}-bot`;
    process.env.TELEGRAM_CHAT_ID = '-100123';
    process.env.TELEGRAM_WEBHOOK_SECRET = `${runId}-webhook`;
    process.env.TELEGRAM_ALLOWED_USERNAMES = 'producer';
    telegramServer = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      telegramRequests.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true, result: request.url?.endsWith('/createForumTopic') ? { message_thread_id: 77, name: 'Release proof' } : { message_id: 321, chat: { id: -100123 } } }));
    });
    await new Promise<void>((resolve) => telegramServer!.listen(0, '127.0.0.1', resolve));
    telegramUrl = `http://127.0.0.1:${(telegramServer.address() as import('node:net').AddressInfo).port}`;
    uninstallTelegramTransport = installTelegramTransportForTests((input, init) => {
      const telegramRequest = new URL(typeof input === 'string' ? input : input.toString());
      return fetch(new URL(telegramRequest.pathname, telegramUrl), init);
    });
  });

  afterEach(async () => {
    await client?.query('delete from public.processed_telegram_updates where update_id = $1', [updateId]);
    await client?.query('delete from public.api_rate_limits where key_hash = $1', [
      createHash('sha256').update(`session-create:${clientIp}`).digest('hex')
    ]);
    await client?.query('delete from public.handoff_outbox where session_id in (select id from public.sessions where source_url = $1)', [origin]);
    await client?.query('begin');
    try {
      await client?.query('set local session_replication_role = replica');
      await client?.query('delete from public.session_consents where session_id in (select id from public.sessions where source_url = $1)', [origin]);
      await client?.query('set local session_replication_role = origin');
      await client?.query('delete from public.sessions where source_url = $1', [origin]);
      await client?.query('commit');
    } catch (error) {
      await client?.query('rollback');
      throw error;
    }
    telegramRequests.length = 0;
  });

  afterAll(async () => {
    uninstallTelegramTransport?.();
    await new Promise<void>((resolve, reject) => telegramServer?.close((error) => error ? reject(error) : resolve()));
    await client?.end();
  });

  it('persists a capability, transfers a consented canonical draft, dispatches it, and returns a signed reply', async () => {
    const sessionResponse = await createSession(new Request(`${origin}/api/sessions`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-vercel-forwarded-for': clientIp },
      body: JSON.stringify({ sourceUrl: origin, consentVersion: '1.1', consentedAt: '2026-07-14T00:00:00.000Z' })
    }));
    const session = await sessionResponse.json() as { sessionId: string };
    const capability = sessionResponse.headers.get('set-cookie')?.match(/session_capability=([^;]+)/)?.[1] ?? '';
    const auth = { origin, 'x-session-capability': capability, 'content-type': 'application/json' };

    expect(sessionResponse.status).toBe(200);
    await expect(client!.query('select capability_hash, capability_expires_at from public.sessions where id = $1', [session.sessionId]))
      .resolves.toMatchObject({ rows: [expect.objectContaining({ capability_hash: expect.any(String), capability_expires_at: expect.any(Date) })] });
    await expect(recordConsent(new Request(`${origin}/api/projects/${session.sessionId}/consent`, { method: 'POST', headers: auth, body: JSON.stringify({ scope: 'producer_transfer', granted: true, noticeVersion: '1.1' }) }), { params: Promise.resolve({ sessionId: session.sessionId }) })).resolves.toHaveProperty('status', 200);
    await expect(client!.query("select granted from public.session_consents where session_id = $1 and scope = 'producer_transfer'", [session.sessionId]))
      .resolves.toMatchObject({ rows: [{ granted: true }] });
    await client!.query('update public.sessions set telegram_thread_id = 77 where id = $1', [session.sessionId]);
    const draftResponse = await updateDraft(new Request(`${origin}/api/projects/${session.sessionId}/draft`, { method: 'PUT', headers: auth, body: JSON.stringify({ fields: [
      { field: 'service', value: 'production', provenance: 'confirmed' }, { field: 'projectScope', value: 'Film', provenance: 'confirmed' },
      { field: 'contactName', value: 'Ada', provenance: 'confirmed' }, { field: 'contactEmail', value: 'ada@example.test', provenance: 'confirmed' }
    ], expectedDraftVersion: 0 }) }), { params: Promise.resolve({ sessionId: session.sessionId }) });
    expect((await draftResponse.json()).draftVersion).toBe(1);
    await expect(client!.query('select draft_version, draft from public.sessions where id = $1', [session.sessionId]))
      .resolves.toMatchObject({ rows: [expect.objectContaining({ draft_version: 1, draft: expect.objectContaining({ contactEmail: expect.any(Object) }) })] });
    const final = await finalizeLead(new Request(`${origin}/api/leads/finalize`, { method: 'POST', headers: auth, body: JSON.stringify({ sessionId: session.sessionId }) }));
    await expect(final.json()).resolves.toMatchObject({
      persisted: true,
      qualificationStatus: 'needs_review',
      score: 5,
      recommendedNextStep: 'manual_review',
      queued: true,
      crmQueued: true
    });
    await expect(client!.query(
      `select c.desired_revision, o.revision, o.operation, o.state
       from public.crm_leads c
       join public.monday_sync_outbox o on o.crm_lead_id = c.id
       where c.source_session_id = $1`,
      [session.sessionId]
    )).resolves.toMatchObject({ rows: [{ desired_revision: 1, revision: 1, operation: 'upsert', state: 'pending' }] });
    await expect(client!.query('select state from public.handoff_outbox where session_id = $1', [session.sessionId]))
      .resolves.toMatchObject({ rows: [{ state: 'pending' }] });
    const dispatched = await dispatchHandoffs(new Request(`${origin}/api/internal/handoff-dispatch`, { method: 'POST', headers: { authorization: `Bearer ${runId}-cron` } }));
    expect((await dispatched.json()).results).toEqual([expect.objectContaining({ status: 'sent' })]);
    await expect(client!.query('select state from public.handoff_outbox where session_id = $1', [session.sessionId]))
      .resolves.toMatchObject({ rows: [{ state: 'sent' }] });
    expect(telegramRequests).toContainEqual(expect.objectContaining({ path: `/bot${runId}-bot/sendMessage`, body: expect.objectContaining({ chat_id: '-100123', message_thread_id: 77 }) }));
    const webhook = await receiveWebhook(new Request(`${origin}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': `${runId}-webhook` }, body: JSON.stringify({ update_id: updateId, message: { message_id: 322, message_thread_id: 77, chat: { id: -100123, type: 'supergroup' }, from: { id: 2, username: 'producer', first_name: 'Pat' }, text: 'We will follow up.' } }) }));
    expect(webhook.status).toBe(200);
    const polled = await pollMessages(new Request(`${origin}/api/telegram/messages?sessionId=${session.sessionId}`, { headers: { 'x-session-capability': capability } }));
    await expect(polled.json()).resolves.toMatchObject({ messages: [expect.objectContaining({ text: 'Pat: We will follow up.' })] });
  });
});
