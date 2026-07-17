import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('group', { name: 'Optional details' })).toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ captured/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('review-panel').textContent).not.toMatch(
      /score|qualified|unqualified|misfit|crm|telegram|revision/i
    );
  });

  test('explains the semantic requirements when the core brief is not ready', () => {
    render(<ReviewPanel {...baseProps} draft={createDefaultLeadDraft()} />);

    expect(screen.getByText('Core brief needs a project need and contact detail')).toBeInTheDocument();
    expect(screen.getByText('Add any useful context, or leave these for the team conversation')).toBeInTheDocument();
    expect(screen.getByTestId('approve-button')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send brief to Balance' })).toHaveAccessibleDescription(
      'Add a project need and contact detail to enable sending.'
    );
  });

  test('keeps a legacy generated summary visible without claiming unsupported attribution', () => {
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

    expect(screen.getByText('Project summary')).toBeInTheDocument();
    expect(screen.getByText('Legacy generated interpretation')).toBeInTheDocument();
    expect(screen.getByText('Core brief needs a project need and contact detail')).toBeInTheDocument();
    expect(screen.getByTestId('approve-button')).toBeDisabled();
  });

  test('uses controller approval state to disable duplicate sends while pending', () => {
    const onApprove = vi.fn();
    const { rerender } = render(<ReviewPanel {...baseProps} draft={readyDraft} mode="summary" onApprove={onApprove} />);

    const button = screen.getByRole('button', { name: 'Send brief to Balance' });
    fireEvent.click(button);
    expect(onApprove).toHaveBeenCalledOnce();

    rerender(<ReviewPanel {...baseProps} draft={readyDraft} mode="summary" onApprove={onApprove} approvalInFlight />);
    const pendingButton = screen.getByRole('button', { name: /sending/i });
    expect(pendingButton).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Sending brief to Balance');
    fireEvent.click(pendingButton);
    expect(onApprove).toHaveBeenCalledOnce();
  });

  test('keeps editor labels persistent and gives inline actions shared mobile-safe classes', () => {
    render(<ReviewPanel {...baseProps} draft={readyDraft} mode="summary" onChange={vi.fn()} provenance={{ projectScope: 'user-stated' }} />);

    const send = screen.getByRole('button', { name: 'Send brief to Balance' });
    expect(send).toHaveClass('balance-widget-action', 'balance-widget-wrap');

    const edit = screen.getByRole('button', { name: 'Edit original wording' });
    expect(edit).toHaveClass('balance-widget-action');
    fireEvent.click(edit);

    const editor = screen.getByRole('textbox', { name: 'Original wording' });
    expect(editor.tagName).toBe('TEXTAREA');
    expect(screen.getByText('Original wording')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save original wording' })).toHaveClass('balance-widget-action');
    expect(screen.getByRole('button', { name: 'Cancel editing original wording' })).toHaveClass('balance-widget-action');
  });

  test('restores focus to the exact edit trigger after cancelling or saving', async () => {
    const onChange = vi.fn().mockResolvedValue({ status: 'saved' });
    render(<ReviewPanel {...baseProps} draft={readyDraft} mode="summary" onChange={onChange} provenance={{ projectScope: 'user-stated' }} />);

    const edit = screen.getByRole('button', { name: 'Edit original wording' });
    fireEvent.click(edit);
    const editor = screen.getByRole('textbox', { name: 'Original wording' });
    expect(editor).toHaveAttribute('aria-labelledby', 'brief-row-label-projectScope');
    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(edit).toHaveFocus());

    fireEvent.click(edit);
    fireEvent.click(screen.getByRole('button', { name: 'Save original wording' }));
    await waitFor(() => expect(edit).toHaveFocus());
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
    render(
      <ReviewPanel
        {...baseProps}
        draft={readyDraft}
        referenceLinks={[{ id: 'reference-1', kind: 'vimeo', url: 'https://vimeo.com/123' }]}
      />
    );

    expect(screen.getByRole('link', { name: 'https://vimeo.com/123' })).toBeInTheDocument();
  });
});
