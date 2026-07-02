import { render, screen, fireEvent } from '@testing-library/react';
import { EssentialsStep } from '@/components/onboarding/essentials-step';
import { createDemoLeadDraft, createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { EssentialFieldKey } from '@/lib/onboarding/flow-config';

test('renders the guided essentials step with demo data', () => {
  render(<EssentialsStep draft={createDemoLeadDraft()} />);

  expect(screen.getByText(/3 of 5 essentials captured/i)).toBeInTheDocument();
  expect(screen.getByText(/What type of services are you exploring/i)).toBeInTheDocument();
  expect(screen.getByText(/Project scope/i)).toBeInTheDocument();
});

test('renders dropdowns for option-based fields', () => {
  render(<EssentialsStep draft={createDefaultLeadDraft()} />);

  const serviceSelect = screen.getByLabelText(/What type of services/i) as HTMLSelectElement;
  expect(serviceSelect.tagName).toBe('SELECT');
  expect(serviceSelect.value).toBe('');
});

test('calls onChange when a dropdown value is selected', () => {
  const handleChange = vi.fn();
  render(<EssentialsStep draft={createDefaultLeadDraft()} onChange={handleChange} />);

  const selects = screen.getAllByRole('combobox');
  fireEvent.change(selects[0], { target: { value: 'production' } });

  expect(handleChange).toHaveBeenCalledWith('service' satisfies EssentialFieldKey, 'production');
});

test('calls onChange when text is typed in textarea', () => {
  const handleChange = vi.fn();
  render(<EssentialsStep draft={createDefaultLeadDraft()} onChange={handleChange} />);

  const textarea = screen.getByPlaceholderText(/Describe the project/i);
  fireEvent.change(textarea, { target: { value: 'Brand launch campaign' } });

  expect(handleChange).toHaveBeenCalledWith('projectScope' satisfies EssentialFieldKey, 'Brand launch campaign');
});

test('shows zero progress with empty draft', () => {
  render(<EssentialsStep draft={createDefaultLeadDraft()} />);

  expect(screen.getByText(/0 of 5 essentials captured/i)).toBeInTheDocument();
});
