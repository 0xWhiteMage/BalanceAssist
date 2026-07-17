import { describe, expect, test } from 'vitest';
import {
  getCurrentIntakeStage,
  INTAKE_STAGES
} from '@/lib/conversation/intake-stage';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

describe('intake stage model', () => {
  test('defines the four canonical stages in display order', () => {
    expect(INTAKE_STAGES.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'project', label: 'Project and objective' },
      { id: 'audience', label: 'Audience and outputs' },
      { id: 'planning', label: 'Timeline and budget' },
      { id: 'references-contact', label: 'References and contact' }
    ]);
  });

  test.each([
    ['project', {}],
    ['audience', { projectScope: 'A launch film', projectObjective: 'Build awareness' }],
    [
      'planning',
      {
        projectScope: 'A launch film',
        projectObjective: 'Build awareness',
        audience: 'Young adults',
        intendedOutputs: 'Hero film and cut-downs'
      }
    ],
    [
      'references-contact',
      {
        projectScope: 'A launch film',
        projectObjective: 'Build awareness',
        audience: 'Young adults',
        intendedOutputs: 'Hero film and cut-downs',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k'
      }
    ]
  ])('derives the %s stage from canonical draft values', (expected, values) => {
    expect(getCurrentIntakeStage({ ...createDefaultLeadDraft(), ...values }).id).toBe(expected);
  });

  test.each([
    { projectScope: 'A launch film' },
    { projectType: 'Animation' }
  ])('accepts any approved project-need field with an objective', (projectNeed) => {
    expect(getCurrentIntakeStage({
      ...createDefaultLeadDraft(),
      ...projectNeed,
      projectObjective: 'Build awareness'
    }).id).toBe('audience');
  });

  test('treats a service-only canonical draft as project-need evidence', () => {
    expect(getCurrentIntakeStage({
      ...createDefaultLeadDraft(),
      service: 'production',
      projectObjective: 'Build awareness'
    }).id).toBe('audience');
  });

  test.each(['Not sure yet', 'Skip', 'Prefer not to share'])(
    'treats the literal uncertainty answer %s as answered',
    (answer) => {
      expect(getCurrentIntakeStage({
        ...createDefaultLeadDraft(),
        projectScope: 'A launch film',
        projectObjective: 'Build awareness',
        audience: answer,
        intendedOutputs: answer,
        timelineBand: answer,
        budgetBand: answer
      }).id).toBe('references-contact');
    }
  );

  test('does not require timeline or budget to complete the core project and audience stages', () => {
    expect(getCurrentIntakeStage({
      ...createDefaultLeadDraft(),
      projectScope: 'A launch film',
      projectObjective: 'Build awareness',
      audience: 'Young adults',
      intendedOutputs: 'Hero film and cut-downs'
    }).id).toBe('planning');
  });

  test('enters references and contact without inventing reference capture state', () => {
    const draft = {
      ...createDefaultLeadDraft(),
      projectScope: 'A launch film',
      projectObjective: 'Build awareness',
      audience: 'Young adults',
      intendedOutputs: 'Hero film and cut-downs',
      timelineBand: 'Skip',
      budgetBand: 'Prefer not to share'
    };

    expect(getCurrentIntakeStage(draft).id).toBe('references-contact');
    expect(draft.referencesStatus).toBe('');
  });
});
