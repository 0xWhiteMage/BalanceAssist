import { render, screen } from '@testing-library/react';
import WidgetPage from '@/app/widget/page';

test('renders the Balance Assist guided onboarding widget', () => {
  render(<WidgetPage />);

  expect(screen.getByText(/3 of 5 essentials captured/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Start your project brief/i })).toBeInTheDocument();
});
