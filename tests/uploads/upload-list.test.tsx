import { render, screen } from '@testing-library/react';
import { UploadList } from '@/components/uploads/upload-list';

test('shows upload statuses including needs human review', () => {
  render(<UploadList uploads={[{ id: '1', name: 'brief.pdf', status: 'needs_human_review' }]} />);
  expect(screen.getByText(/Needs human review/i)).toBeInTheDocument();
});
