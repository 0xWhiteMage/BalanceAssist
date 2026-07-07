import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectBriefCard } from '@/components/widget/widget-overlay-parts';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

const readyDraft = {
  ...createDefaultLeadDraft(),
  service: 'production' as const,
  projectType: 'Video',
  projectScope: '30s launch animation',
  scopePolished: '30s launch animation',
  timelineBand: '1-2-months' as const,
  budgetBand: '20k-50k' as const,
  contactName: 'Jayden',
  contactEmail: 'jayden@example.com'
};

describe('ProjectBriefCard', () => {
  test('defaults to the full row layout (compact=false) with side-by-side label and value', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={false}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByTestId('project-brief-card')).toHaveAttribute('data-compact', 'false');
    expect(screen.queryAllByTestId('brief-row-status')).toHaveLength(0);
    expect(screen.queryAllByTestId('brief-row-value')).toHaveLength(0);
  });

  test('compact mode marks the card and renders one filled-row indicator per captured field', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByTestId('project-brief-card')).toHaveAttribute('data-compact', 'true');

    // readyDraft fills 7 of 8 rows (Company is left empty)
    expect(screen.getAllByTestId('brief-row-status')).toHaveLength(7);
    expect(screen.getAllByTestId('brief-row-value')).toHaveLength(7);

    // Captured values are still rendered in the DOM (just on a second indented line).
    expect(screen.getByText('30s launch animation')).toBeInTheDocument();
    expect(screen.getByText('jayden@example.com')).toBeInTheDocument();
  });

  test('compact mode keeps every label visible (icon + label on one line)', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByText('Project scope')).toBeInTheDocument();
    expect(screen.getByText('Project type')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('Contact name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  test('compact mode omits status indicator + indented value for unfilled rows', () => {
    const empty = createDefaultLeadDraft();
    render(
      <ProjectBriefCard
        draft={empty}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.queryAllByTestId('brief-row-status')).toHaveLength(0);
    expect(screen.queryAllByTestId('brief-row-value')).toHaveLength(0);
  });
});
