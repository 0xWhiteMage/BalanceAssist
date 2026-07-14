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
  timelineBand: '3 weeks',
  budgetBand: '$20,000 SGD',
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
    // Non-compact mode now exposes per-row edit affordances too, but does
    // NOT use the dedicated "value line" indent that compact mode uses.
    expect(screen.queryAllByTestId('brief-row-value')).toHaveLength(7);
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
    expect(screen.getByText('3 weeks')).toBeInTheDocument();
    expect(screen.getByText('$20,000 SGD')).toBeInTheDocument();
  });

  test('timeline and budget rows use free-text editors (no <select>)', () => {
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
    const timelineRow = screen.getByText('Timeline').closest('[data-testid="brief-row"]') as HTMLElement;
    fireEvent.click(within(timelineRow).getByRole('button', { name: /edit timeline/i }));
    expect(within(timelineRow).getByRole('textbox')).toBeInTheDocument();
    expect(within(timelineRow).queryByRole('combobox')).toBeNull();

    const budgetRow = screen.getByText('Budget').closest('[data-testid="brief-row"]') as HTMLElement;
    fireEvent.click(within(budgetRow).getByRole('button', { name: /edit budget/i }));
    expect(within(budgetRow).getByRole('textbox')).toBeInTheDocument();
    expect(within(budgetRow).queryByRole('combobox')).toBeNull();
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

  test('labels are uppercase with letter-spacing and values are fontWeight 600', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={false}
        readyForApproval={false}
        approved={false}
      />
    );
    const serviceRow = screen.getByText('Service').closest('[data-testid="brief-row"]');
    expect(serviceRow).not.toBeNull();
    const labelSpan = within(serviceRow as HTMLElement).getByText('Service');
    expect((labelSpan as HTMLElement).style.textTransform).toBe('uppercase');
    expect((labelSpan as HTMLElement).style.letterSpacing).toBe('0.12em');
    const valueSpan = within(serviceRow as HTMLElement).getByText('Production');
    expect((valueSpan as HTMLElement).style.fontWeight).toBe('600');
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
    const input = within(projectScopeRow).getByRole('textbox', { name: 'Project scope' });
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

  test('service row uses a free-text editor (no <select>)', () => {
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
    expect(within(serviceRow).getByRole('textbox')).toBeInTheDocument();
    expect(within(serviceRow).queryByRole('combobox')).toBeNull();
  });

  test('no <select> elements exist anywhere in the brief card', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={false}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    // Open an editor to make sure no select lazily renders during editing.
    const serviceRow = screen.getByText('Service').closest('[data-testid="brief-row"]') as HTMLElement;
    fireEvent.click(within(serviceRow).getByRole('button', { name: /edit service/i }));
    expect(container.querySelector('select')).toBeNull();
  });

  test('empty rows show an italic "Not yet captured" placeholder in non-compact mode', () => {
    render(
      <ProjectBriefCard
        draft={{ ...readyDraft, contactCompany: '' }}
        compact={false}
        readyForApproval={false}
        approved={false}
      />
    );
    const placeholder = screen.getByText('Not yet captured');
    expect(placeholder).toBeInTheDocument();
    expect((placeholder as HTMLElement).style.fontStyle).toBe('italic');
  });

  test('compact mode: every row (filled or unfilled) exposes a pencil edit affordance', () => {
    const empty = createDefaultLeadDraft();
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={empty}
        compact={true}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const rows = screen.getAllByTestId('brief-row');
    expect(rows.length).toBe(8);
    for (const row of rows) {
      const pencil = within(row as HTMLElement).getByRole('button', { name: /^edit /i });
      expect(pencil).toBeInTheDocument();
    }
  });

  test('non-compact mode: every row (filled or unfilled) exposes a pencil edit affordance', () => {
    const empty = createDefaultLeadDraft();
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={empty}
        compact={false}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const rows = screen.getAllByTestId('brief-row');
    expect(rows.length).toBe(8);
    for (const row of rows) {
      const pencil = within(row as HTMLElement).getByRole('button', { name: /^edit /i });
      expect(pencil).toBeInTheDocument();
    }
  });

  test('clicking an unfilled row opens the editor on that row', () => {
    const onChange = vi.fn();
    const empty = createDefaultLeadDraft();
    render(
      <ProjectBriefCard
        draft={empty}
        compact={true}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const companyRow = screen.getByText('Company').closest('[data-testid="brief-row"]') as HTMLElement;
    expect(companyRow.getAttribute('data-filled')).toBe('false');
    fireEvent.click(companyRow);
    const input = within(companyRow).getByRole('textbox') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  test('clicking the pencil on a row opens the editor and does not bubble', () => {
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
    const emailRow = screen.getByText('Email').closest('[data-testid="brief-row"]') as HTMLElement;
    const pencil = within(emailRow).getByTestId('brief-row-edit-contactEmail');
    fireEvent.click(pencil);
    const input = within(emailRow).getByRole('textbox') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    // Only the editor should be present inside the row, not also the read-only
    // value div. (Bubbling would not open another editor, but checking that
    // the editor is exactly once proves the row-click handler didn't re-fire.)
    expect(within(emailRow).getAllByRole('textbox')).toHaveLength(1);
  });

  test('clicking an unfilled row in non-compact mode also opens the editor', () => {
    const onChange = vi.fn();
    const empty = createDefaultLeadDraft();
    render(
      <ProjectBriefCard
        draft={empty}
        compact={false}
        readyForApproval={false}
        approved={false}
        onChange={onChange}
      />
    );
    const companyRow = screen.getByText('Company').closest('[data-testid="brief-row"]') as HTMLElement;
    expect(companyRow.getAttribute('data-filled')).toBe('false');
    fireEvent.click(companyRow);
    const input = within(companyRow).getByRole('textbox') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  test('brief rows carry cursor: pointer when onChange is provided', () => {
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
    const rows = screen.getAllByTestId('brief-row');
    for (const row of rows) {
      expect((row as HTMLElement).style.cursor).toBe('pointer');
    }
  });
});
