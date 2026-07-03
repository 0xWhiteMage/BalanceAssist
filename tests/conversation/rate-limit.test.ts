import { checkRateLimit, gcRateLimits, resetRateLimit } from '@/lib/conversation/rate-limit';

test('checkRateLimit allows up to 20 calls in a window', () => {
  resetRateLimit('test-session-1');
  for (let i = 0; i < 20; i += 1) {
    expect(checkRateLimit('test-session-1').allowed).toBe(true);
  }
  expect(checkRateLimit('test-session-1').allowed).toBe(false);
});

test('checkRateLimit reports remaining count', () => {
  resetRateLimit('test-session-2');
  expect(checkRateLimit('test-session-2').remaining).toBe(19);
  expect(checkRateLimit('test-session-2').remaining).toBe(18);
});

test('gcRateLimits returns 0 when nothing is expired', () => {
  resetRateLimit('test-session-3');
  checkRateLimit('test-session-3');
  expect(gcRateLimits()).toBe(0);
});

test('resetRateLimit clears a session', () => {
  resetRateLimit('test-session-4');
  expect(checkRateLimit('test-session-4').remaining).toBe(19);
  resetRateLimit('test-session-4');
  expect(checkRateLimit('test-session-4').remaining).toBe(19);
});
