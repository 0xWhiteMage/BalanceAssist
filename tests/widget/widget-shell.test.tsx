import { render, screen } from '@testing-library/react';
import { WidgetShell } from '@/components/widget/widget-shell';

test('renders Balance Assist with human escalation visible', () => {
  render(
    <WidgetShell>
      <div>Body</div>
    </WidgetShell>
  );

  expect(screen.getByText(/Balance Assist/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Talk to a human/i })).toBeInTheDocument();
});
