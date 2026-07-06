import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BriefReviewScreen } from '@/components/widget/brief-review-screen';

test('renders all main fields', () => {
  render(
    <BriefReviewScreen
      draft={{
        service: 'production',
        projectType: 'Video',
        projectScope: '30s animation',
        scopePolished: '30s animation',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'Jayden',
        contactCompany: 'Samsung',
        contactEmail: 'jayden@example.com'
      }}
      referenceLinks={[]}
      referenceFiles={[]}
      onSend={() => {}}
      onRefine={() => {}}
    />
  );
  expect(screen.getByText(/Send to Balance team/i)).toBeInTheDocument();
  expect(screen.getByText(/Jayden/i)).toBeInTheDocument();
  expect(screen.getByText(/30s animation/i)).toBeInTheDocument();
});

test('invokes onSend when the primary CTA is clicked', () => {
  const onSend = vi.fn();
  render(
    <BriefReviewScreen
      draft={{
        service: 'production',
        projectScope: 'X',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: 'A',
        contactEmail: 'a@b.com',
        projectType: '',
        scopePolished: ''
      }}
      referenceLinks={[]}
      referenceFiles={[]}
      onSend={onSend}
      onRefine={() => {}}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Send to Balance team/i }));
  expect(onSend).toHaveBeenCalled();
});

test('renders empty-state hint when attachments are absent', () => {
  render(
    <BriefReviewScreen
      draft={{ service: '', projectScope: 'x', timelineBand: 'asap', budgetBand: 'under-20k', contactName: 'a', contactEmail: 'a@b.com', projectType: '', scopePolished: '' }}
      referenceLinks={[]}
      referenceFiles={[]}
      onSend={() => {}}
      onRefine={() => {}}
    />
  );
  expect(screen.getByText(/Drop your deck|Add a reference|Paste a link/i)).toBeInTheDocument();
});
