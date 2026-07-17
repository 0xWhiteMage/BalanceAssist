import { getEssentialsProgress } from '@/lib/onboarding/progress';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

test('counts completed essential fields', () => {
  expect(
    getEssentialsProgress({
      ...createDefaultLeadDraft(),
      service: 'production',
      projectScope: 'Brand campaign',
      timelineBand: '1-2-months',
      budgetBand: '50k-150k',
      contactName: '',
      contactEmail: ''
    })
  ).toEqual({ completed: 4, total: 5 });
});
