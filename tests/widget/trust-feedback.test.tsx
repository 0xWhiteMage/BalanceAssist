import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { TrustFeedback } from '@/components/widget/trust-feedback';

describe('TrustFeedback', () => {
  test('offers only bounded clarity choices without a content field', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<TrustFeedback submitted={false} onSubmit={onSubmit} />);

    expect(screen.getByText('Optional feedback')).toBeVisible();
    expect(screen.getByText('Did Balance Assist create a clear, useful brief?')).toBeVisible();
    expect(screen.getByText('We use this one answer to improve the experience. Your messages are not included.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yes, it helped' })).toHaveClass('balance-widget-action');
    expect(screen.getByRole('button', { name: 'Needs improvement' })).toHaveClass('balance-widget-action');
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Needs improvement' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('not_quite'));
    rerender(<TrustFeedback submitted onSubmit={onSubmit} />);
    expect(screen.getByRole('status')).toHaveTextContent('Feedback saved. Thank you.');
  });

  test('prevents duplicate submission while pending', async () => {
    let resolve: ((saved: boolean) => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    render(<TrustFeedback submitted={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Yes, it helped' }));
    expect(screen.getByRole('button', { name: 'Yes, it helped' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Needs improvement' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving feedback');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it helped' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => resolve?.(true));
  });

  test('announces a failure and allows retry', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<TrustFeedback submitted={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Yes, it helped' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback could not be saved. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it helped' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });
});
