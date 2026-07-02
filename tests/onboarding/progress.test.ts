import { getEssentialsProgress } from '@/lib/onboarding/progress';

test('counts completed essential fields', () => {
  expect(
    getEssentialsProgress({
      service: 'production',
      projectScope: 'Brand campaign',
      timelineBand: '1-2-months',
      budgetBand: '50k-150k',
      contactName: '',
      contactEmail: ''
    })
  ).toEqual({ completed: 4, total: 5 });
});
