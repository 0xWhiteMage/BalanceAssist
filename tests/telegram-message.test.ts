// @vitest-environment node

import { afterEach, describe, expect, test, vi } from 'vitest';
import { HANDOFF_SEND_TIMEOUT_MS, sendTelegramMessage } from '@/lib/telegram';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sendTelegramMessage', () => {
  test('uses the configured HTTP boundary for Telegram sends', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
    vi.stubEnv('TELEGRAM_API_BASE_URL', 'http://127.0.0.1:4010/');
    vi.stubEnv('ALLOW_TEST_TELEGRAM_TRANSPORT', '1');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 7, chat: { id: 123 } } })
    }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTelegramMessage('hello')).resolves.toEqual({ messageId: 7 });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4010/bottest-token/sendMessage',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('does not redirect bot traffic without explicit loopback test mode', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
    vi.stubEnv('TELEGRAM_API_BASE_URL', 'https://attacker.example');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: { message_id: 7, chat: { id: 123 } } }) }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await sendTelegramMessage('secret');

    expect(fetchMock).toHaveBeenCalledWith('https://api.telegram.org/bottest-token/sendMessage', expect.any(Object));
  });

  test('aborts a stalled response body at the hard timeout, below the 90-second send reservation', async () => {
    vi.useFakeTimers();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
    let requestSignal: AbortSignal | undefined;
    const responseJson = vi.fn(() => new Promise<never>((_, reject) => {
      requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return { ok: true, json: responseJson } as unknown as Response;
    }));

    const sending = sendTelegramMessage('hello');
    await vi.advanceTimersByTimeAsync(0);
    expect(responseJson).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(HANDOFF_SEND_TIMEOUT_MS);

    expect(requestSignal?.aborted).toBe(true);
    await expect(sending).resolves.toBeNull();
  });
});
