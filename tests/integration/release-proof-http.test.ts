// @vitest-environment node

import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installTelegramTransportForTests, sendDocument } from '@/lib/telegram';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const artifactsDir = process.env.RELEASE_PROOF_ARTIFACTS_DIR;
const runId = `release-proof-${crypto.randomUUID()}`;
const clientIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
const updateId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1_000_000);
let appUrl = '';
let telegramUrl = '';
let telegramServer: ReturnType<typeof createServer> | undefined;
let productionServer: ReturnType<typeof createServer> | undefined;
let uninstallTelegramTransport: (() => void) | undefined;
const telegramRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
let sessionId: string | undefined;

function writeDiagnostic(line: string) {
  if (!artifactsDir) return;
  mkdirSync(artifactsDir, { recursive: true });
  appendFileSync(`${artifactsDir}/release-proof-http.log`, `${line}\n`);
}

async function waitForServer(url: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The production server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Production Next server did not become ready.');
}

function telegramRequestBody(contentType: string | undefined, body: Buffer): Record<string, unknown> {
  if (contentType?.startsWith('application/json')) return JSON.parse(body.toString() || '{}') as Record<string, unknown>;

  const boundary = contentType?.match(/boundary=([^;]+)/)?.[1];
  if (!boundary) return {};
  const fields: Record<string, unknown> = {};
  for (const part of body.toString('latin1').split(`--${boundary}`)) {
    const name = part.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const value = part.split('\r\n\r\n')[1]?.replace(/\r\n$/, '') ?? '';
    const filename = part.match(/filename="([^"]+)"/)?.[1];
    fields[name] = filename
      ? { filename, contentType: part.match(/Content-Type: ([^\r\n]+)/i)?.[1], byteLength: Buffer.byteLength(value, 'latin1') }
      : value;
  }
  return fields;
}

describe.skipIf(!supabaseUrl || !serviceRoleKey)('release proof HTTP journey', () => {
  const supabase = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : undefined;

  beforeAll(async () => {
    telegramServer = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = telegramRequestBody(request.headers['content-type'], Buffer.concat(chunks));
      telegramRequests.push({ path: request.url ?? '', body });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        result: request.url?.endsWith('/createForumTopic')
          ? { message_thread_id: 77, name: 'Release proof' }
          : { message_id: 321, chat: { id: -100123 } }
      }));
    });
    await new Promise<void>((resolve) => telegramServer!.listen(0, '127.0.0.1', resolve));
    telegramUrl = `http://127.0.0.1:${(telegramServer.address() as AddressInfo).port}`;
    uninstallTelegramTransport = installTelegramTransportForTests((input, init) => {
      const telegramRequest = new URL(typeof input === 'string' ? input : input.toString());
      return fetch(new URL(telegramRequest.pathname, telegramUrl), init);
    });

    const port = 39000 + Math.floor(Math.random() * 1000);
    appUrl = `http://127.0.0.1:${port}`;
    Object.assign(process.env, {
      ALLOWED_ORIGINS: appUrl,
      TRUSTED_CLIENT_IP_HEADER: 'x-vercel-forwarded-for',
      CRON_SECRET: `${runId}-cron`,
      TELEGRAM_BOT_TOKEN: `${runId}-bot`,
      TELEGRAM_CHAT_ID: '-100123',
      TELEGRAM_WEBHOOK_SECRET: `${runId}-webhook`,
      TELEGRAM_ALLOWED_USERNAMES: 'producer',
      SUPABASE_PRIVATE_UPLOAD_BUCKET: 'temporary-attachments'
    });
    const next = (await import('next')).default({ dev: false, hostname: '127.0.0.1', port });
    await next.prepare();
    const handler = next.getRequestHandler();
    productionServer = createServer((request, response) => handler(request, response));
    await new Promise<void>((resolve) => productionServer!.listen(port, '127.0.0.1', resolve));
    await waitForServer(appUrl);
  });

  afterEach(async () => {
    if (sessionId) await supabase!.from('sessions').delete().eq('id', sessionId);
    await supabase!.from('processed_telegram_updates').delete().eq('update_id', updateId);
    await supabase!.from('api_rate_limits').delete().eq(
      'key_hash',
      createHash('sha256').update(`session-create:${clientIp}`).digest('hex')
    );
    sessionId = undefined;
    telegramRequests.length = 0;
  });

  afterAll(async () => {
    uninstallTelegramTransport?.();
    if (productionServer) await new Promise<void>((resolve) => productionServer!.close(() => resolve()));
    if (telegramServer) await new Promise<void>((resolve) => telegramServer!.close(() => resolve()));
  });

  it('drives a consented human relay from queued through delivered and replied across real HTTP boundaries', async () => {
    const headers = {
      origin: appUrl,
      'content-type': 'application/json',
      'x-vercel-forwarded-for': clientIp
    };
    const sessionResponse = await fetch(`${appUrl}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceUrl: appUrl, consentVersion: '1.2', consentedAt: new Date().toISOString() })
    });
    const session = await sessionResponse.json() as { sessionId: string };
    sessionId = session.sessionId;
    const capability = sessionResponse.headers.get('set-cookie')?.match(/session_capability=([^;]+)/)?.[1] ?? '';
    const authorizedHeaders = { ...headers, 'x-session-capability': capability };

    expect(sessionResponse.status).toBe(200);
    await expect(supabase!.from('sessions').select('capability_hash').eq('id', sessionId).single())
      .resolves.toMatchObject({ data: expect.objectContaining({ capability_hash: expect.any(String) }), error: null });
    await expect(fetch(`${appUrl}/api/projects/${sessionId}/consent`, {
      method: 'POST', headers: authorizedHeaders,
      body: JSON.stringify({ scope: 'analysis', granted: true, noticeVersion: '1.2' })
    })).resolves.toHaveProperty('status', 200);
    await expect(fetch(`${appUrl}/api/projects/${sessionId}/consent`, {
      method: 'POST', headers: authorizedHeaders,
      body: JSON.stringify({ scope: 'human_contact', granted: true, noticeVersion: '1.2' })
    })).resolves.toHaveProperty('status', 200);
    const attachment = new FormData();
    attachment.set('sessionId', sessionId);
    attachment.set('mode', 'analysis');
    attachment.set('file', new Blob(['private analysis'], { type: 'text/plain' }), 'private-analysis.txt');
    await expect(fetch(`${appUrl}/api/telegram/upload`, {
      method: 'POST',
      headers: {
        origin: appUrl,
        'x-session-capability': capability,
        'x-session-id': sessionId,
        'x-upload-mode': 'analysis'
      },
      body: attachment
    })).resolves.toHaveProperty('status', 200);
    const relayRequestId = crypto.randomUUID();
    const relay = await fetch(`${appUrl}/api/telegram/relay`, {
      method: 'POST', headers: { ...authorizedHeaders, 'x-request-id': relayRequestId },
      body: JSON.stringify({ sessionId, text: 'Synthetic release proof: please confirm relay state.' })
    });
    expect(relay.status).toBe(200);
    await expect(relay.json()).resolves.toMatchObject({ ok: true, persisted: true, queued: true });
    await expect(supabase!.from('handoff_outbox').select('state').eq('session_id', sessionId).single())
      .resolves.toMatchObject({ data: { state: 'pending' }, error: null });
    const queued = await fetch(`${appUrl}/api/telegram/messages?sessionId=${sessionId}`, { headers: authorizedHeaders });
    await expect(queued.json()).resolves.toMatchObject({ outgoingStatus: 'queued', messages: [] });

    const retry = await fetch(`${appUrl}/api/telegram/relay`, {
      method: 'POST', headers: { ...authorizedHeaders, 'x-request-id': relayRequestId },
      body: JSON.stringify({ sessionId, text: 'Synthetic release proof: please confirm relay state.' })
    });
    await expect(retry.json()).resolves.toMatchObject({ ok: true, persisted: true, queued: true });
    const relayRows = await supabase!.from('handoff_outbox').select('id, state').eq('session_id', sessionId);
    expect(relayRows).toMatchObject({ data: [expect.objectContaining({ state: 'pending' })], error: null });

    const dispatched = await fetch(`${appUrl}/api/internal/handoff-dispatch`, {
      method: 'POST', headers: { authorization: `Bearer ${runId}-cron` }
    });
    await expect(dispatched.json()).resolves.toMatchObject({ results: [expect.objectContaining({ status: 'sent' })] });
    expect(telegramRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `/bot${runId}-bot/createForumTopic`, body: expect.objectContaining({ chat_id: '-100123' }) }),
      expect.objectContaining({ path: `/bot${runId}-bot/sendMessage`, body: expect.objectContaining({ message_thread_id: 77, text: 'Synthetic release proof: please confirm relay state.' }) })
    ]));
    expect(telegramRequests.filter(({ path }) => path.endsWith('/createForumTopic'))).toHaveLength(1);
    expect(telegramRequests.filter(({ path }) => path.endsWith('/sendMessage'))).toHaveLength(1);
    expect(JSON.stringify(telegramRequests)).not.toContain('private analysis');
    expect(JSON.stringify(telegramRequests)).not.toContain('private-analysis.txt');
    await expect(supabase!.from('handoff_outbox').select('state').eq('session_id', sessionId).single())
      .resolves.toMatchObject({ data: { state: 'sent' }, error: null });
    const delivered = await fetch(`${appUrl}/api/telegram/messages?sessionId=${sessionId}`, { headers: authorizedHeaders });
    await expect(delivered.json()).resolves.toMatchObject({ outgoingStatus: 'delivered', messages: [] });
    await expect(sendDocument(77, Buffer.from('release proof'), 'Release proof document', 'release-proof.txt'))
      .resolves.toMatchObject({ ok: true });
    expect(telegramRequests).toContainEqual(expect.objectContaining({
      path: `/bot${runId}-bot/sendDocument`,
      body: expect.objectContaining({
        chat_id: '-100123',
        message_thread_id: '77',
        caption: 'Release proof document',
        document: { filename: 'release-proof.txt', contentType: 'application/octet-stream', byteLength: 13 }
      })
    }));

    const webhook = await fetch(`${appUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': `${runId}-webhook` },
      body: JSON.stringify({ update_id: updateId, message: {
        message_id: 322, message_thread_id: 77, chat: { id: -100123, type: 'supergroup' },
        from: { id: 2, username: 'producer', first_name: 'Pat' }, text: 'We will follow up.'
      } })
    });
    expect(webhook.status).toBe(200);
    const polled = await fetch(`${appUrl}/api/telegram/messages?sessionId=${sessionId}`, { headers: authorizedHeaders });
    await expect(polled.json()).resolves.toMatchObject({
      outgoingStatus: 'delivered',
      messages: [expect.objectContaining({ text: 'Pat: We will follow up.' })]
    });
  });
});
