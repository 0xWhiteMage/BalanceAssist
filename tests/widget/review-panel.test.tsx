import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewPanel } from '@/components/widget/review-panel';
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
  contactCompany: 'Samsung',
  contactEmail: 'jayden@example.com'
};

describe('ReviewPanel', () => {
  test('renders progress strip with completed count', () => {
    render(
      <ReviewPanel
        draft={createDefaultLeadDraft()}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(screen.getByText(/0 of 8 captured/i)).toBeInTheDocument();
    expect(screen.getByText(/Project Brief/i)).toBeInTheDocument();
  });

  test('updates completed count when draft is ready', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(screen.getByText(/8 of 8 captured/i)).toBeInTheDocument();
  });

  test('essentials mode does not render Approve CTA', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /approve & send to team/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue refining/i })).not.toBeInTheDocument();
  });

  test('summary mode renders Approve CTA + Continue refining when ready and not approved', () => {
    const onApprove = vi.fn();
    const onContinueRefining = vi.fn();
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="summary"
        onApprove={onApprove}
        onContinueRefining={onContinueRefining}
      />
    );
    expect(screen.getByRole('button', { name: /approve & send to team/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue refining/i })).toBeInTheDocument();
  });

  test('summary mode invokes onApprove when the primary CTA is clicked', () => {
    const onApprove = vi.fn();
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="summary"
        onApprove={onApprove}
        onContinueRefining={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /approve & send to team/i }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  test('summary mode invokes onContinueRefining when the secondary CTA is clicked', () => {
    const onContinueRefining = vi.fn();
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={onContinueRefining}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /continue refining/i }));
    expect(onContinueRefining).toHaveBeenCalledOnce();
  });

  test('renders the approved confirmation when approved=true', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={true}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(screen.getByText(/The Balance team has been notified/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve & send to team/i })).not.toBeInTheDocument();
  });

  test('summary mode does NOT render Approve CTA when draft is not ready', () => {
    render(
      <ReviewPanel
        draft={createDefaultLeadDraft()}
        approved={false}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /approve & send to team/i })).not.toBeInTheDocument();
  });

  test('exposes mode via data-mode attribute', () => {
    const { rerender } = render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(screen.getByTestId('review-panel').getAttribute('data-mode')).toBe('essentials');
    rerender(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(screen.getByTestId('review-panel').getAttribute('data-mode')).toBe('summary');
  });

  test('summary mode renders the Approve button with a static warmGold gradient and no pulse animation', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    const approveButton = screen.getByRole('button', { name: /approve & send to team/i });
    expect(approveButton.getAttribute('data-pulse')).toBeNull();
    expect(approveButton.style.animation === '' || approveButton.style.animation === 'none').toBe(true);
    expect(approveButton.style.background).toMatch(/linear-gradient/);
    expect(approveButton.style.animation).not.toMatch(/approve-pulse/i);
  });

  test('summary mode replaces the Approve button with a green confirmation pill when approved', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={true}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /approve & send to team/i })).not.toBeInTheDocument();
    const confirmation = screen.getByTestId('approve-confirmation');
    expect(confirmation).toBeInTheDocument();
    expect(confirmation.textContent).toMatch(/Balance team has been notified/i);
  });

  test('essentials mode never shows the Approve pulse even when the brief is ready', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    const approveButton = screen.queryByRole('button', { name: /approve & send to team/i });
    expect(approveButton).not.toBeInTheDocument();
  });

  test('Approve button background is a static warmGold linear gradient (no animation property)', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    const approveButton = screen.getByRole('button', { name: /approve & send to team/i }) as HTMLButtonElement;
    expect(approveButton.style.background).toMatch(/linear-gradient/);
    expect(approveButton.style.background).toMatch(/#dbb580|#ffd293/i);
    expect(approveButton.style.animation === '' || approveButton.style.animation === 'none').toBe(true);
    expect(approveButton.getAttribute('style') ?? '').not.toMatch(/animation\s*:\s*[^n]/i);
  });
});
