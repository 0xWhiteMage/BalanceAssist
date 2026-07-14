// @vitest-environment node

import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const artifactsDir = process.env.RELEASE_PROOF_ARTIFACTS_DIR;
const runId = `release-proof-${crypto.randomUUID()}`;
const clientIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
const updateId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1_000_000);
let appUrl = '';
let telegramUrl = '';
let server: ReturnType<typeof createServer> | undefined;
let next: ReturnType<typeof spawn> | undefined;
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

describe.skipIf(!supabaseUrl || !serviceRoleKey)('release proof HTTP journey', () => {
  const supabase = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : undefined;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
      telegramRequests.push({ path: request.url ?? '', body });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        result: request.url?.endsWith('/createForumTopic')
          ? { message_thread_id: 77, name: 'Release proof' }
          : { message_id: 321, chat: { id: -100123 } }
      }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    telegramUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const port = 39000 + Math.floor(Math.random() * 1000);
    appUrl = `http://127.0.0.1:${port}`;
    next = spawn('npm', ['run', 'start', '--', '--hostname', '127.0.0.1', '--port', String(port)], {
      env: {
        ...process.env,
        ALLOWED_ORIGINS: appUrl,
        TRUSTED_CLIENT_IP_HEADER: 'x-vercel-forwarded-for',
        CRON_SECRET: `${runId}-cron`,
        TELEGRAM_BOT_TOKEN: `${runId}-bot`,
        TELEGRAM_CHAT_ID: '-100123',
        TELEGRAM_WEBHOOK_SECRET: `${runId}-webhook`,
        TELEGRAM_ALLOWED_USERNAMES: 'producer',
        ALLOW_TEST_TELEGRAM_TRANSPORT: '1',
        TELEGRAM_API_BASE_URL: telegramUrl
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    next.stdout?.on('data', (chunk) => writeDiagnostic(chunk.toString()));
    next.stderr?.on('data', (chunk) => writeDiagnostic(chunk.toString()));
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
    next?.kill('SIGTERM');
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it('drives the consented handoff and team reply across real HTTP boundaries', async () => {
    const headers = {
      origin: appUrl,
      'content-type': 'application/json',
      'x-vercel-forwarded-for': clientIp
    };
    const sessionResponse = await fetch(`${appUrl}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceUrl: appUrl, consentVersion: '1.0', consentedAt: new Date().toISOString() })
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
      body: JSON.stringify({ scope: 'producer_transfer', granted: true, noticeVersion: '1.0' })
    })).resolves.toHaveProperty('status', 200);
    await expect(fetch(`${appUrl}/api/projects/${sessionId}/draft`, {
      method: 'PUT', headers: authorizedHeaders,
      body: JSON.stringify({ fields: [
        { field: 'service', value: 'production', provenance: 'confirmed' },
        { field: 'projectScope', value: 'Film', provenance: 'confirmed' },
        { field: 'contactName', value: runId, provenance: 'confirmed' },
        { field: 'contactEmail', value: `${runId}@example.test`, provenance: 'confirmed' }
      ] })
    })).resolves.toHaveProperty('status', 200);
    const finalized = await fetch(`${appUrl}/api/leads/finalize`, {
      method: 'POST', headers: authorizedHeaders,
      body: JSON.stringify({ sessionId, qualificationStatus: 'qualified' })
    });
    expect(finalized.status).toBe(200);
    await expect(supabase!.from('handoff_outbox').select('state').eq('session_id', sessionId).single())
      .resolves.toMatchObject({ data: { state: 'pending' }, error: null });

    const dispatched = await fetch(`${appUrl}/api/internal/handoff-dispatch`, {
      method: 'POST', headers: { authorization: `Bearer ${runId}-cron` }
    });
    await expect(dispatched.json()).resolves.toMatchObject({ results: [expect.objectContaining({ status: 'sent' })] });
    expect(telegramRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `/bot${runId}-bot/createForumTopic`, body: expect.objectContaining({ chat_id: '-100123' }) }),
      expect.objectContaining({ path: `/bot${runId}-bot/sendMessage`, body: expect.objectContaining({ message_thread_id: 77 }) })
    ]));

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
    await expect(polled.json()).resolves.toMatchObject({ messages: [expect.objectContaining({ text: 'Pat: We will follow up.' })] });
  });
});
