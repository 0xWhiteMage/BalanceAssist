// @vitest-environment node

import { afterEach, describe, expect, test, vi } from 'vitest';
import { HANDOFF_SEND_TIMEOUT_MS, sendTelegramMessage } from '@/lib/telegram';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sendTelegramMessage', () => {
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
