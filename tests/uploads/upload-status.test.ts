import { getUploadStatusCopy } from '@/lib/uploads/status';

test('maps upload states to readable labels', () => {
  expect(getUploadStatusCopy('needs_human_review').label).toBe('Needs human review');
});
