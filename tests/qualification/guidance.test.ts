import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { SummaryPanel } from '@/components/onboarding/summary-panel';
import { createDemoLeadDraft } from '@/lib/onboarding/default-state';
import { getBudgetGuidance } from '@/lib/qualification/budget-matrix';
import { getTimelineGuidance } from '@/lib/qualification/timeline-matrix';

test('renders indicative guidance with disclaimer', () => {
  render(
    createElement(SummaryPanel, {
      draft: {
        ...createDemoLeadDraft(),
        projectScope: 'Brand campaign',
        contactName: 'Jane Lee',
        contactEmail: 'jane@example.com'
      }
    })
  );

  expect(screen.getByText(/Indicative only/i)).toBeInTheDocument();
  expect(screen.getByText(/Budget guidance/i)).toBeInTheDocument();
  expect(screen.getByText(/Timeline guidance/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Book a call/i })).toBeInTheDocument();
});

test('returns fallback guidance when no band is selected', () => {
  expect(getBudgetGuidance('').label).toBe('Unknown');
  expect(getTimelineGuidance('').label).toBe('Unknown');
});
