import { createSessionPayloadSchema } from '@/lib/api/contracts';

test('validates a session create payload', () => {
  const result = createSessionPayloadSchema.safeParse({ sourceUrl: 'https://www.balancestudio.tv' });
  expect(result.success).toBe(true);
});
