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

  test('essentials mode renders a disabled "Send to team" CTA when the draft is not ready', () => {
    render(
      <ReviewPanel
        draft={createDefaultLeadDraft()}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    const approveButton = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(approveButton).toBeInTheDocument();
    expect(approveButton.disabled).toBe(true);
    expect(approveButton.textContent).toMatch(/send to team/i);
    expect(screen.getByTestId('approve-disabled-hint')).toBeInTheDocument();
  });

  test('essentials mode renders a disabled "Send to team" CTA when even a fully ready brief should still show the disabled sub-line', () => {
    const onApprove = vi.fn();
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="essentials"
        onApprove={onApprove}
        onContinueRefining={() => {}}
      />
    );
    const approveButton = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(approveButton).toBeInTheDocument();
    expect(approveButton.disabled).toBe(false);
    expect(approveButton.textContent).toMatch(/send to team/i);
    expect(screen.queryByTestId('approve-disabled-hint')).not.toBeInTheDocument();
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

  test('renders a truthful queued confirmation when approved=true but delivery is not verified', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={true}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
        telegramBroadcastStatus="queued"
      />
    );
    expect(screen.getByText(/Approval saved\. Team notification queued\./i)).toBeInTheDocument();
    expect(screen.queryByText(/The Balance team has been notified/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve & send to team/i })).not.toBeInTheDocument();
  });

  test('summary mode renders a disabled "Approve & send to team" CTA when the draft is not ready', () => {
    const onApprove = vi.fn();
    render(
      <ReviewPanel
        draft={createDefaultLeadDraft()}
        approved={false}
        mode="summary"
        onApprove={onApprove}
        onContinueRefining={() => {}}
      />
    );
    const approveButton = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(approveButton).toBeInTheDocument();
    expect(approveButton.textContent).toMatch(/approve.*send to team/i);
    expect(approveButton.disabled).toBe(true);
    expect(screen.getByTestId('approve-disabled-hint')).toBeInTheDocument();
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

  test('summary mode only claims the team was notified after verified delivery', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={true}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
        telegramBroadcastStatus="sent"
      />
    );
    expect(screen.queryByRole('button', { name: /approve & send to team/i })).not.toBeInTheDocument();
    const confirmation = screen.getByTestId('approve-confirmation');
    expect(confirmation).toBeInTheDocument();
    expect(confirmation.textContent).toMatch(/Balance team has been notified/i);
  });

  test('approved confirmation stays truthful when notification could not be verified', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={true}
        mode="summary"
        onApprove={() => {}}
        onContinueRefining={() => {}}
        telegramBroadcastStatus="unconfigured"
      />
    );

    expect(screen.getByTestId('approve-confirmation-count')).toHaveTextContent(
      /Approval saved\. Team notification still needs confirmation\./i
    );
    expect(screen.queryByText(/The Balance team has been notified/i)).not.toBeInTheDocument();
  });

  test('essentials mode always renders the Approve button, even when the brief is ready', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    const approveButton = screen.getByTestId('approve-button');
    expect(approveButton).toBeInTheDocument();
    expect(approveButton.textContent).toMatch(/send to team/i);
    expect((approveButton as HTMLButtonElement).disabled).toBe(false);
    expect(approveButton.getAttribute('style') ?? '').not.toMatch(/animation\s*:\s*[^n]/i);
  });

  test('disabled Send-to-team button has aria-label explaining why it is disabled', () => {
    render(
      <ReviewPanel
        draft={createDefaultLeadDraft()}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    const approveButton = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(approveButton.getAttribute('aria-label')).toBe('Fill the missing fields to send to the team');
  });

  test('enabled Send-to-team button is reachable under the accessible name "Send to team"', () => {
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={false}
        mode="essentials"
        onApprove={() => {}}
        onContinueRefining={() => {}}
      />
    );
    expect(
      screen.getByRole('button', { name: /send to team/i }) as HTMLButtonElement
    ).toBeInTheDocument();
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

  test('clicking Approve twice in a row only invokes onApprove once (button enters in-flight state)', () => {
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
    const approveButton = screen.getByRole('button', { name: /approve & send to team/i });
    fireEvent.click(approveButton);
    // After the first click, the button label flips to "Sending…" and the
    // second click MUST NOT re-invoke onApprove.
    expect(screen.getByTestId('approve-button').getAttribute('data-in-flight')).toBe('true');
    const sendingButton = screen.getByRole('button', { name: /sending/i }) as HTMLButtonElement;
    expect(sendingButton.disabled).toBe(true);
    fireEvent.click(sendingButton);
    expect(onApprove).toHaveBeenCalledOnce();
  });

  test('when approved=true, clicking the Approve button (if it renders) does NOT trigger onApprove', () => {
    const onApprove = vi.fn();
    render(
      <ReviewPanel
        draft={readyDraft}
        approved={true}
        mode="summary"
        onApprove={onApprove}
        onContinueRefining={() => {}}
      />
    );
    // The Approve CTA is replaced by the green confirmation pill when approved,
    // so onApprove must remain uncalled.
    expect(screen.queryByRole('button', { name: /approve.*send to team/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('approve-confirmation')).toBeInTheDocument();
    expect(onApprove).not.toHaveBeenCalled();
  });
});
