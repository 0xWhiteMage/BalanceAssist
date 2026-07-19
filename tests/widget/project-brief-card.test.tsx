import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectBriefCard } from '@/components/widget/widget-overlay-parts';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

const readyDraft = {
  ...createDefaultLeadDraft(),
  service: 'production' as const,
  projectType: 'Video',
  projectScope: 'Make it feel raw\nand human',
  projectObjective: 'Build launch awareness',
  audience: 'Young adults',
  intendedOutputs: 'Hero film and social cut-downs',
  scopePolished: 'A naturalistic launch campaign',
  timelineBand: '3 weeks',
  budgetBand: '$20,000 SGD',
  contactName: 'Jayden',
  contactEmail: 'jayden@example.com'
};

describe('ProjectBriefCard', () => {
  test('uses attribution labels only when canonical provenance supports them', () => {
    const { rerender } = render(
      <ProjectBriefCard
        draft={readyDraft}
        provenance={{ projectScope: 'user-stated', scopePolished: 'inferred' }}
        compact={false}
      />
    );
    expect(screen.getByText('Original wording')).toBeInTheDocument();
    expect(screen.getByText('AI-drafted summary')).toBeInTheDocument();

    rerender(
      <ProjectBriefCard
        draft={readyDraft}
        provenance={{ projectScope: 'confirmed', scopePolished: 'confirmed' }}
        compact={false}
      />
    );
    expect(screen.getByText('User-edited wording')).toBeInTheDocument();
    expect(screen.getByText('Edited draft')).toBeInTheDocument();
    expect(screen.queryByText('Original wording')).not.toBeInTheDocument();
    expect(screen.queryByText('AI-drafted summary')).not.toBeInTheDocument();
  });

  test('keeps an editor open with entered text and retry controls after async save failure', async () => {
    const onChange = vi.fn()
      .mockResolvedValueOnce({ status: 'failed', message: 'The edit was not saved.' })
      .mockResolvedValueOnce({ status: 'saved' });
    render(
      <ProjectBriefCard draft={readyDraft} provenance={{ projectScope: 'user-stated' }} compact onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit original wording' }));
    const editor = screen.getByRole('textbox', { name: 'Original wording' });
    fireEvent.change(editor, { target: { value: 'My retained correction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save original wording' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The edit was not saved.');
    expect(screen.getByRole('textbox', { name: 'Original wording' })).toHaveValue('My retained correction');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving original wording' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Original wording' })).not.toBeInTheDocument());
  });

  test('disables duplicate Save while an async edit is pending', async () => {
    let resolveSave!: (value: { status: 'saved' }) => void;
    const onChange = vi.fn(() => new Promise<{ status: 'saved' }>((resolve) => { resolveSave = resolve; }));
    render(<ProjectBriefCard draft={readyDraft} provenance={{ projectScope: 'user-stated' }} compact onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit original wording' }));
    const save = screen.getByRole('button', { name: 'Save original wording' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onChange).toHaveBeenCalledOnce();
    expect(save).toBeDisabled();
    resolveSave({ status: 'saved' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Original wording' })).not.toBeInTheDocument());
  });

  test('keeps compact editor controls inside the brief row width', () => {
    render(<ProjectBriefCard draft={readyDraft} compact onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit contact name' }));

    const editor = screen.getByRole('textbox', { name: 'Contact name' });
    const editorContainer = editor.parentElement;

    expect(editorContainer).toHaveStyle({ width: '100%', minWidth: '0', paddingLeft: '20px' });
    expect(editorContainer).not.toHaveStyle({ marginLeft: '20px' });
  });

  test('groups core and optional fields and uses only native 44px edit controls', () => {
    render(<ProjectBriefCard draft={readyDraft} provenance={{ projectScope: 'user-stated' }} compact onChange={vi.fn()} />);
    const core = screen.getByRole('group', { name: 'Core details' });
    const optional = screen.getByRole('group', { name: 'Optional details' });
    expect(within(core).getByText('Original wording')).toBeInTheDocument();
    expect(within(core).getByText('Contact name')).toBeInTheDocument();
    expect(within(optional).getByText('Audience')).toBeInTheDocument();
    expect(within(optional).getByText('Timeline')).toBeInTheDocument();
    const editButtons = screen.getAllByRole('button', { name: /^edit /i });
    expect(editButtons.length).toBeGreaterThan(0);
    for (const button of editButtons) {
      expect(button.style.minWidth).toBe('44px');
      expect(button.style.minHeight).toBe('44px');
    }
    fireEvent.click(screen.getByText('Company'));
    expect(screen.queryByRole('textbox', { name: 'Company' })).not.toBeInTheDocument();
  });

  test('adds and removes private reference links inline with visible errors', async () => {
    const onAddReference = vi.fn().mockResolvedValueOnce({ status: 'failed', message: 'Link could not be saved.' });
    const onRemoveReference = vi.fn().mockResolvedValueOnce({ status: 'failed', message: 'Link could not be removed.' });
    render(
      <ProjectBriefCard
        draft={readyDraft}
        provenance={{ projectScope: 'user-stated' }}
        compact
        referenceLinks={[{ id: 'reference-1', kind: 'vimeo', url: 'https://vimeo.com/123' }]}
        onAddReference={onAddReference}
        onRemoveReference={onRemoveReference}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Reference URL' }), { target: { value: 'https://example.com/board' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Link could not be saved.');
    expect(screen.getByRole('textbox', { name: 'Reference URL' })).toHaveValue('https://example.com/board');

    fireEvent.click(screen.getByRole('button', { name: 'Remove https://vimeo.com/123' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Link could not be removed.');
  });

  test('marks a legacy HTTP reference unsupported while keeping removal available', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact
        referenceLinks={[{ id: 'legacy-reference', kind: 'other', url: 'http://legacy.example.com/board' }]}
        onRemoveReference={vi.fn().mockResolvedValue({ status: 'saved' })}
      />
    );

    expect(screen.getByText(/unsupported.*not transferable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove http://legacy.example.com/board' })).toBeEnabled();
  });
  test('shows the "Project Brief" title and no "key fields captured" subhead', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={false}
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
      />
    );
    expect(screen.getByTestId('project-brief-card')).toHaveAttribute('data-compact', 'false');
    expect(screen.queryAllByTestId('brief-row-status')).toHaveLength(0);
    // Non-compact mode now exposes per-row edit affordances too, but does
    // NOT use the dedicated "value line" indent that compact mode uses.
    expect(screen.queryAllByTestId('brief-row-value')).toHaveLength(11);
  });

  test('compact mode marks the card and renders one filled-row indicator per captured field', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
      />
    );
    expect(screen.getByTestId('project-brief-card')).toHaveAttribute('data-compact', 'true');

    expect(screen.getAllByTestId('brief-row-status')).toHaveLength(11);
    expect(screen.getAllByTestId('brief-row-value')).toHaveLength(11);

    // Captured values are still rendered in the DOM (just on a second indented line).
    expect(screen.getByText(/Make it feel raw/)).toBeInTheDocument();
    expect(screen.getByText('jayden@example.com')).toBeInTheDocument();
  });

  test('compact mode keeps every label visible (icon + label on one line)', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
      />
    );
    expect(screen.getByText('Project description')).toBeInTheDocument();
    expect(screen.getByText('Project summary')).toBeInTheDocument();
    expect(screen.getByText('Project objective')).toBeInTheDocument();
    expect(screen.getByText('Audience')).toBeInTheDocument();
    expect(screen.getByText('Intended outputs')).toBeInTheDocument();
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
      />
    );
    expect(screen.queryByText(/key fields captured/i)).not.toBeInTheDocument();
  });

  test('compact mode renders human-readable service / timeline / budget labels', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
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
      />
    );
    expect(screen.getByText('Live action')).toBeInTheDocument();
  });

  test('labels are uppercase with letter-spacing and values are fontWeight 600', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={false}
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

  test('keeps original wording and AI-drafted summary separate without substitution', () => {
    render(
      <ProjectBriefCard
        draft={readyDraft}
        provenance={{ projectScope: 'user-stated', scopePolished: 'inferred' }}
        compact={false}
      />
    );

    const originalRow = screen.getByText('Original wording').closest('[data-testid="brief-row"]') as HTMLElement;
    expect(originalRow).toHaveTextContent('Make it feel raw and human');
    expect(screen.getByText('A naturalistic launch campaign')).toBeInTheDocument();
  });

  test('does not repeat a generated summary that matches the original wording', () => {
    render(
      <ProjectBriefCard
        draft={{ ...readyDraft, scopePolished: readyDraft.projectScope }}
        provenance={{ projectScope: 'user-stated', scopePolished: 'inferred' }}
      />
    );

    expect(screen.queryByText('AI-drafted summary')).toBeNull();
    expect(screen.getByText('Original wording')).toBeVisible();
  });

  test('opens long semantic fields in labelled multiline editors', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        onChange={onChange}
      />
    );
    for (const label of ['Project description', 'Project summary', 'Project objective', 'Audience', 'Intended outputs']) {
      const row = screen.getByText(label).closest('[data-testid="brief-row"]') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: new RegExp(`edit ${label}`, 'i') }));
      expect(within(row).getByRole('textbox', { name: label }).tagName).toBe('TEXTAREA');
    }
  });

  test('Enter adds a newline and explicit Save commits a multiline edit', async () => {
    const onChange = vi.fn().mockResolvedValue({ status: 'saved' });
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        onChange={onChange}
      />
    );
    const projectScopeRow = screen.getByText('Project description').closest('[data-testid="brief-row"]') as HTMLElement;
    fireEvent.click(within(projectScopeRow).getByRole('button', { name: /edit project description/i }));
    const input = within(projectScopeRow).getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '60s hero spot\nwith cut-downs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(projectScopeRow).getByRole('button', { name: 'Save project description' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('projectScope', '60s hero spot\nwith cut-downs'));
  });

  test('service row uses a free-text editor (no <select>)', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
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
      />
    );
    const companyRow = screen.getByText('Company').closest('[data-testid="brief-row"]') as HTMLElement;
    const placeholder = within(companyRow).getByText('Not yet captured');
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
        onChange={onChange}
      />
    );
    const rows = screen.getAllByTestId('brief-row');
    expect(rows.length).toBe(11);
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
        onChange={onChange}
      />
    );
    const rows = screen.getAllByTestId('brief-row');
    expect(rows.length).toBe(11);
    for (const row of rows) {
      const pencil = within(row as HTMLElement).getByRole('button', { name: /^edit /i });
      expect(pencil).toBeInTheDocument();
    }
  });

  test('clicking an unfilled row does not open an editor', () => {
    const onChange = vi.fn();
    const empty = createDefaultLeadDraft();
    render(
      <ProjectBriefCard
        draft={empty}
        compact={true}
        onChange={onChange}
      />
    );
    const companyRow = screen.getByText('Company').closest('[data-testid="brief-row"]') as HTMLElement;
    expect(companyRow.getAttribute('data-filled')).toBe('false');
    fireEvent.click(companyRow);
    expect(within(companyRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('clicking the pencil on a row opens the editor and does not bubble', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
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

  test('clicking an unfilled row in non-compact mode does not open an editor', () => {
    const onChange = vi.fn();
    const empty = createDefaultLeadDraft();
    render(
      <ProjectBriefCard
        draft={empty}
        compact={false}
        onChange={onChange}
      />
    );
    const companyRow = screen.getByText('Company').closest('[data-testid="brief-row"]') as HTMLElement;
    expect(companyRow.getAttribute('data-filled')).toBe('false');
    fireEvent.click(companyRow);
    expect(within(companyRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('brief rows do not imply pointer activation when only Edit is interactive', () => {
    const onChange = vi.fn();
    render(
      <ProjectBriefCard
        draft={readyDraft}
        compact={true}
        onChange={onChange}
      />
    );
    const rows = screen.getAllByTestId('brief-row');
    for (const row of rows) {
      expect((row as HTMLElement).style.cursor).toBe('default');
    }
  });
});
