// @vitest-environment node

import { expect, test } from 'vitest';

test('GET /api/health returns an unauthenticated smoke-safe response', async () => {
  const { GET } = await import('@/app/api/health/route');
  const response = await GET();

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
});
