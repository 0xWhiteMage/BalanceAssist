const REQUEST_TIMEOUT_MS = 10000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      credentials: 'include',
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchJsonWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs?: number
): Promise<{ response: Response; body: unknown } | null> {
  try {
    const response = await fetchWithTimeout(input, init, timeoutMs);
    return { response, body: await response.json() };
  } catch {
    return null;
  }
}
