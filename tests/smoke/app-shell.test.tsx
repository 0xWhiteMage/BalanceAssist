import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';

test('renders Balance Assist home shell', () => {
  render(<HomePage />);
  expect(screen.getByRole('heading', { name: /Balance Assist/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Try it on the live site/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /View reference board/i })).toBeInTheDocument();
});
