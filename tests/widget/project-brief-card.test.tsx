import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ProjectBriefCard } from '@/components/widget/widget-overlay-parts';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

const readyDraft = {
  ...createDefaultLeadDraft(),
  service: 'production' as const,
  projectType: 'Video',
  projectScope: '30s launch animation',
  scopePolished: '30s launch animation',
  timelineBand: '1-2-months' as const,
  budgetBand: '20k-50k' as const,
  contactName: 'Jayden',
  contactEmail: 'jayden@example.com'
};

describe('ProjectBriefCard', () => {
  test('shows the "Project Brief" title and no "key fields captured" subhead', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={false}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByText('Project Brief')).toBeInTheDocument();
    expect(screen.queryByText(/key fields captured/i)).not.toBeInTheDocument();
  });

  test('defaults to the full row layout (compact=false) with side-by-side label and value', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={false}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByTestId('project-brief-card')).toHaveAttribute('data-compact', 'false');
    expect(screen.queryAllByTestId('brief-row-status')).toHaveLength(0);
    expect(screen.queryAllByTestId('brief-row-value')).toHaveLength(0);
  });

  test('compact mode marks the card and renders one filled-row indicator per captured field', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByTestId('project-brief-card')).toHaveAttribute('data-compact', 'true');

    // readyDraft fills 7 of 8 rows (Company is left empty)
    expect(screen.getAllByTestId('brief-row-status')).toHaveLength(7);
    expect(screen.getAllByTestId('brief-row-value')).toHaveLength(7);

    // Captured values are still rendered in the DOM (just on a second indented line).
    expect(screen.getByText('30s launch animation')).toBeInTheDocument();
    expect(screen.getByText('jayden@example.com')).toBeInTheDocument();
  });

  test('compact mode keeps every label visible (icon + label on one line)', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByText('Project scope')).toBeInTheDocument();
    expect(screen.getByText('Project type')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('Contact name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  test('compact mode omits status indicator + indented value for unfilled rows', () => {
    const empty = createDefaultLeadDraft();
    render(
      <ProjectBriefCard
        draft={empty}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.queryAllByTestId('brief-row-status')).toHaveLength(0);
    expect(screen.queryAllByTestId('brief-row-value')).toHaveLength(0);
  });

  test('compact mode omits the "key fields captured" caption (progress lives on the rail)', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.queryByText(/key fields captured/i)).not.toBeInTheDocument();
  });

  test('compact mode renders human-readable service / timeline / budget labels', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('1-2 months')).toBeInTheDocument();
    expect(screen.getByText('$20,000-$50,000')).toBeInTheDocument();
  });

  test('compact mode capitalizes projectType and converts dashes to spaces', () => {
    render(
      <ProjectBriefCard
        draft={{ ...readyDraft, projectType: 'live-action' }}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    expect(screen.getByText('Live action')).toBeInTheDocument();
  });

  test('compact mode label and value spans carry text-transform: capitalize', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
      />
    );
    const serviceRow = screen.getByText('Service').closest('[data-testid="brief-row"]');
    expect(serviceRow).not.toBeNull();
    const labelSpan = within(serviceRow as HTMLElement).getByText('Service');
    expect((labelSpan as HTMLElement).style.textTransform).toBe('capitalize');
    const valueSpan = within(serviceRow as HTMLElement).getByText('Production');
    expect((valueSpan as HTMLElement).style.textTransform).toBe('capitalize');
  });

  test('clicking the edit button on a free-text row opens an inline input', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const projectScopeRow = screen.getByText('Project scope').closest('[data-testid="brief-row"]') as HTMLElement;
    const editButton = within(projectScopeRow).getByRole('button', { name: /edit project scope/i });
    fireEvent.click(editButton);
    const input = within(projectScopeRow).getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('30s launch animation');
  });

  test('pressing Enter on the inline input fires onChange with the new value', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const projectScopeRow = screen.getByText('Project scope').closest('[data-testid="brief-row"]') as HTMLElement;
    fireEvent.click(within(projectScopeRow).getByRole('button', { name: /edit project scope/i }));
    const input = within(projectScopeRow).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60s hero spot' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('projectScope', '60s hero spot');
  });

  test('select-style fields render a <select> with the human-readable option labels', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const serviceRow = screen.getByText('Service').closest('[data-testid="brief-row"]') as HTMLElement;
    fireEvent.click(within(serviceRow).getByRole('button', { name: /edit service/i }));
    const select = within(serviceRow).getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Production' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Post-Production' })).toBeInTheDocument();
  });

  test('select element carries colorScheme=dark + brand caret color so the native chrome renders dark', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const serviceRow = screen.getByText('Service').closest('[data-testid="brief-row"]') as HTMLElement;
    fireEvent.click(within(serviceRow).getByRole('button', { name: /edit service/i }));
    const select = within(serviceRow).getByRole('combobox') as HTMLSelectElement;
    expect(select.style.colorScheme).toBe('dark');
    expect(select.style.caretColor).toBeTruthy();
    expect(select.style.caretColor).not.toBe('');
  });

  test('each <option> inside the brief-editing select carries an inline dark-style color', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const serviceRow = screen.getByText('Service').closest('[data-testid="brief-row"]') as HTMLElement;
    fireEvent.click(within(serviceRow).getByRole('button', { name: /edit service/i }));
    const select = within(serviceRow).getByRole('combobox') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option')) as HTMLOptionElement[];
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      // jsdom returns the inline style string; just confirm color is set.
      expect(option.style.color).toBeTruthy();
      expect(option.style.color).not.toBe('');
      expect(option.style.background).toBeTruthy();
      expect(option.style.background).not.toBe('');
    }
  });
});
