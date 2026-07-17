// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { IntakeStageProgress } from '@/components/widget/intake-stage-progress';

describe('IntakeStageProgress', () => {
  test('renders the four canonical stages as a named ordered list with textual status', () => {
    render(<IntakeStageProgress currentStageId="audience" />);

    const list = screen.getByRole('list', { name: 'Intake stages' });
    expect(list.tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(list).toHaveTextContent('Project and objective');
    expect(list).toHaveTextContent('Audience and outputs');
    expect(list).toHaveTextContent('Timeline and budget');
    expect(list).toHaveTextContent('References and contact');
    expect(screen.getByText('Stage 2 of 4')).toBeVisible();
    expect(list.querySelector('li[aria-current="step"]')).toHaveTextContent('Audience and outputs (Current)');
    expect(list.querySelector('li:first-child')).not.toHaveAttribute('aria-current');
  });

  test('announces a canonical stage change without relying on color or motion', () => {
    const { rerender } = render(<IntakeStageProgress currentStageId="project" />);

    const announcement = screen.getByRole('status');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent('Stage 1 of 4: Project and objective');

    rerender(<IntakeStageProgress currentStageId="planning" />);

    expect(announcement).toHaveTextContent('Stage 3 of 4: Timeline and budget');
    expect(screen.getByText('Stage 3 of 4')).toBeVisible();
    expect(screen.getByTestId('intake-stage-progress')).toHaveClass('balance-widget-wrap', 'balance-widget-motion');
  });
});
