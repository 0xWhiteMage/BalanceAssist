import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReviewPanel } from '@/components/widget/review-panel';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

const readyDraft = {
  ...createDefaultLeadDraft(),
  service: 'production' as const,
  projectScope: 'Make a launch film',
  projectObjective: 'Build awareness',
  audience: 'Young adults',
  intendedOutputs: 'Hero film and cut-downs',
  scopePolished: 'A campaign launch film for a younger audience',
  timelineBand: 'Not sure yet',
  budgetBand: 'Prefer not to share',
  contactName: 'Jayden',
  contactEmail: 'jayden@example.com'
};

const baseProps = {
  approved: false,
  mode: 'essentials' as const,
  onApprove: vi.fn(),
  onContinueRefining: vi.fn()
};

describe('ReviewPanel', () => {
  test('renders semantic core and optional groups without field counts or internal words', () => {
    render(<ReviewPanel {...baseProps} draft={readyDraft} />);

    expect(screen.getByText('Core brief ready')).toBeInTheDocument();
    expect(screen.getByText('Optional details')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ captured/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('review-panel').textContent).not.toMatch(
      /score|qualified|unqualified|misfit|crm|telegram|revision/i
    );
  });

  test('explains the semantic requirements when the core brief is not ready', () => {
    render(<ReviewPanel {...baseProps} draft={createDefaultLeadDraft()} />);

    expect(screen.getByText('Core brief needs a project need and contact route')).toBeInTheDocument();
    expect(screen.getByText('Add any useful context, or leave these for the team conversation')).toBeInTheDocument();
    expect(screen.getByTestId('approve-button')).toBeDisabled();
  });

  test('keeps a legacy AI-drafted summary visible without treating it as core evidence', () => {
    render(
      <ReviewPanel
        {...baseProps}
        draft={{
          ...createDefaultLeadDraft(),
          scopePolished: 'Legacy generated interpretation',
          contactEmail: 'jayden@example.com'
        }}
      />
    );

    expect(screen.getByText('AI-drafted summary')).toBeInTheDocument();
    expect(screen.getByText('Legacy generated interpretation')).toBeInTheDocument();
    expect(screen.getByText('Core brief needs a project need and contact route')).toBeInTheDocument();
    expect(screen.getByTestId('approve-button')).toBeDisabled();
  });

  test('uses the public send label and invokes approval once while pending', () => {
    const onApprove = vi.fn();
    render(<ReviewPanel {...baseProps} draft={readyDraft} mode="summary" onApprove={onApprove} />);

    const button = screen.getByRole('button', { name: 'Send brief to Balance' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: /sending/i }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  test('uses the updated send label after a canonical edit', () => {
    render(<ReviewPanel {...baseProps} draft={readyDraft} mode="summary" requiresReapproval />);

    expect(screen.getByRole('button', { name: 'Send updated brief to Balance' })).toBeInTheDocument();
  });

  test('shows only observable persisted, queued, or delivered confirmation copy', () => {
    const { rerender } = render(
      <ReviewPanel {...baseProps} draft={readyDraft} approved transferStatus="saved" />
    );
    expect(screen.getByText('Brief saved')).toBeInTheDocument();

    rerender(<ReviewPanel {...baseProps} draft={readyDraft} approved transferStatus="queued" />);
    expect(screen.getByText('Queued for the Balance team')).toBeInTheDocument();

    rerender(<ReviewPanel {...baseProps} draft={readyDraft} approved transferStatus="delivered" />);
    expect(screen.getByText('Delivered to the Balance team')).toBeInTheDocument();
    expect(screen.getByTestId('review-panel').textContent).not.toMatch(/reviewed|approved/i);
  });

  test('passes restored reference links through to the editable brief', () => {
    const onEditReferences = vi.fn();
    render(
      <ReviewPanel
        {...baseProps}
        draft={readyDraft}
        referenceLinks={[{ kind: 'vimeo', url: 'https://vimeo.com/123' }]}
        onEditReferences={onEditReferences}
      />
    );

    expect(screen.getByRole('link', { name: 'https://vimeo.com/123' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit reference links' }));
    expect(onEditReferences).toHaveBeenCalledOnce();
  });
});
