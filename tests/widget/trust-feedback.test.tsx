import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { TrustFeedback } from '@/components/widget/trust-feedback';

describe('TrustFeedback', () => {
  test('offers only bounded clarity choices without a content field', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<TrustFeedback submitted={false} onSubmit={onSubmit} />);

    expect(screen.getByText('Was this clear?')).toBeVisible();
    expect(screen.getByText('Only this choice is recorded, not your messages.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveClass('balance-widget-action');
    expect(screen.getByRole('button', { name: 'Not quite' })).toHaveClass('balance-widget-action');
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Not quite' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('not_quite'));
    rerender(<TrustFeedback submitted onSubmit={onSubmit} />);
    expect(screen.getByRole('status')).toHaveTextContent('Thanks for the feedback.');
  });

  test('prevents duplicate submission while pending', async () => {
    let resolve: ((saved: boolean) => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    render(<TrustFeedback submitted={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not quite' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving feedback');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => resolve?.(true));
  });

  test('announces a failure and allows retry', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<TrustFeedback submitted={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback was not saved. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });
});
