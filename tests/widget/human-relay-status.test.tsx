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

    const action = screen.getByRole('button', { name: /Talk to the team without AI/ });
    expect(action).toHaveAttribute('type', 'button');
    expect(action).toHaveClass('balance-widget-action');
    expect(screen.getByRole('link', { name: 'Email the team' })).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
    expect(screen.getByRole('link', { name: 'Book a call' })).toHaveAttribute('href', 'https://calendly.com/balance/test');
  });

  test('describes unavailable delivery without provider detail', () => {
    render(<HumanFooter isTeamConnected={true} humanStatus="unavailable" onConnect={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Message delivery unavailable');
    expect(screen.queryByText(/provider|telegram|private provider failure/i)).toBeNull();
  });

  test('keeps direct email and booking recovery available for unavailable delivery', () => {
    render(<HumanFallbacks calendlyUrl="https://calendly.com/balance/test" deliveryUnavailable={true} />);

    expect(screen.getByText('Message delivery is unavailable. Please email the team or book a call instead.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Email the team' })).toHaveAttribute('href', 'mailto:hello@balancestudio.tv');
    expect(screen.getByRole('link', { name: 'Book a call' })).toHaveAttribute('href', 'https://calendly.com/balance/test');
    expect(screen.queryByText(/provider|telegram|private provider failure/i)).toBeNull();
  });

  test('reports queued delivery separately from visible team response evidence', () => {
    render(<HumanFooter isTeamConnected={true} hasTeamReply={true} humanStatus="queued" onConnect={vi.fn()} />);

    expect(screen.getByText('Queued for the Balance team')).toBeVisible();
    expect(screen.getByText('Team response received')).toBeVisible();
    expect(screen.queryByText('Replied by team')).toBeNull();
  });
});
