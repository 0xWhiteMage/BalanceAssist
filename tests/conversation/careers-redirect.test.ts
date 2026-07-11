import { isCareersIntent, getCareersRedirect } from '@/lib/conversation/careers-redirect';

test('returns the official Balance careers URL', () => {
  expect(getCareersRedirect()).toBe('https://balancestudio.tv/careers');
});

test.each([
  'are you hiring',
  'do you have any job openings',
  'I want to apply for a position',
  'how do I send my CV',
  'are there any career opportunities',
  'I\'m looking for a job',
  'do you recruit designers',
  'can I join the team',
  'any internships available',
  'I\'d like to work at Balance',
  'any open roles',
  'submit my resume',
  'open positions at the studio',
  'employment opportunities',
  'work for Balance Studio',
])('detects careers intent in "%s"', (input) => {
  expect(isCareersIntent(input)).toBe(true);
});

test.each([
  'how much does a 30s video cost',
  'what services do you offer',
  'tell me about your portfolio',
  'I have a project brief',
  'what\'s your process',
  'can you help me write a script',
  'hello',
  'nice weather today',
])('does not detect careers intent in "%s"', (input) => {
  expect(isCareersIntent(input)).toBe(false);
});
