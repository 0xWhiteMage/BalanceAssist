import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BriefPanelTab } from '@/components/widget/brief-panel-tab';

describe('BriefPanelTab', () => {
  test('renders a button with an accessible label', () => {
    render(<BriefPanelTab open={false} onToggle={() => {}} />);
    const btn = screen.getByRole('button', { name: /project brief/i });
    expect(btn).toBeInTheDocument();
  });

  test('invokes onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<BriefPanelTab open={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /project brief/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  test('invokes onFirstReady when pulse prop transitions false→true', () => {
    const onFirstReady = vi.fn();
    const { rerender } = render(<BriefPanelTab open={false} pulse={false} onToggle={() => {}} onFirstReady={onFirstReady} />);
    rerender(<BriefPanelTab open={false} pulse={true} onToggle={() => {}} onFirstReady={onFirstReady} />);
    expect(onFirstReady).toHaveBeenCalledOnce();
  });

  test('does NOT re-invoke onFirstReady if pulse stays true on rerender', () => {
    const onFirstReady = vi.fn();
    const { rerender } = render(<BriefPanelTab open={false} pulse={true} onToggle={() => {}} onFirstReady={onFirstReady} />);
    rerender(<BriefPanelTab open={false} pulse={true} onToggle={() => {}} onFirstReady={onFirstReady} />);
    expect(onFirstReady).toHaveBeenCalledOnce();
  });

  test('renders an inline-SVG fallback so the chevron is visible without webfonts', () => {
    const { container } = render(<BriefPanelTab open={false} onToggle={() => {}} />);
    const btn = screen.getByRole('button', { name: /project brief/i });
    const svg = btn.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(container.querySelector('button svg')).toBeInTheDocument();
  });

  test('does not render the "Review brief" tooltip when pulse is inactive', () => {
    render(<BriefPanelTab open={false} pulse={false} onToggle={() => {}} />);
    expect(screen.queryByText(/review brief/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('renders the "Review brief" tooltip only while pulse is active', () => {
    const onFirstReady = vi.fn();
    const { rerender } = render(
      <BriefPanelTab open={false} pulse={false} onToggle={() => {}} onFirstReady={onFirstReady} />
    );
    expect(screen.queryByText(/review brief/i)).not.toBeInTheDocument();
    rerender(<BriefPanelTab open={false} pulse={true} onToggle={() => {}} onFirstReady={onFirstReady} />);
    expect(screen.getByRole('tooltip', { name: /review brief/i })).toBeInTheDocument();
    expect(screen.getByText(/review brief/i)).toBeInTheDocument();
  });
});
