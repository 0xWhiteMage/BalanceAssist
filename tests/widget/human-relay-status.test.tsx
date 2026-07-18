// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { HumanFallbacks, HumanFooter } from '@/components/widget/widget-overlay-parts';

describe('human relay public status', () => {
  test('keeps non-AI, email, and booking routes available during AI intake', () => {
    render(
      <HumanFooter
        isTeamConnected={false}
        humanStatus="idle"
        calendlyUrl="https://calendly.com/balance/test"
        onConnect={vi.fn()}
      />
    );

    const action = screen.getByRole('button', { name: /Message the team without AI/ });
    expect(action).toHaveAttribute('type', 'button');
    expect(action).toHaveClass('balance-widget-contact-action');
    expect(screen.getByRole('link', { name: 'Email us' })).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
    expect(screen.getByRole('link', { name: 'Schedule a call' })).toHaveAttribute('href', 'https://calendly.com/balance/test');
    expect(screen.getByText('Email Us')).toBeVisible();
    expect(screen.getByText('Schedule a Call')).toBeVisible();
    expect(screen.getByText('Message the Team')).toBeVisible();
  });

  test('describes unavailable delivery without provider detail', () => {
    render(<HumanFooter isTeamConnected={true} humanStatus="unavailable" onConnect={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Message delivery is unavailable.');
    expect(screen.queryByText(/provider|telegram|private provider failure/i)).toBeNull();
  });

  test('keeps direct email and booking recovery available for unavailable delivery', () => {
    render(<HumanFallbacks calendlyUrl="https://calendly.com/balance/test" deliveryUnavailable={true} />);

    expect(screen.getByText('Message delivery is unavailable. Please email the team or book a call instead.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Email us' })).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
    expect(screen.getByRole('link', { name: 'Schedule a call' })).toHaveAttribute('href', 'https://calendly.com/balance/test');
    expect(screen.queryByText(/provider|telegram|private provider failure/i)).toBeNull();
  });

  test('prioritizes visible team response evidence over queued delivery', () => {
    render(<HumanFooter isTeamConnected={true} hasTeamReply={true} humanStatus="queued" onConnect={vi.fn()} />);

    expect(screen.getByText('New reply from the Balance team')).toBeVisible();
    expect(screen.queryByText(/queued/i)).toBeNull();
    expect(screen.queryByText('Replied by team')).toBeNull();
  });
});
