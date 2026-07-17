import { describe, expect, test } from 'vitest';
import {
  formatIntakeStageRecap,
  getCompletedIntakeStageCount,
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

  test.each([
    [0, {}],
    [1, { projectScope: 'Launch film', projectObjective: 'Build awareness' }],
    [2, {
      projectScope: 'Launch film', projectObjective: 'Build awareness', audience: 'Young adults', intendedOutputs: 'Hero film'
    }],
    [3, {
      projectScope: 'Launch film', projectObjective: 'Build awareness', audience: 'Young adults', intendedOutputs: 'Hero film',
      timelineBand: '1-2-months', budgetBand: '20k-50k'
    }],
    [4, {
      projectScope: 'Launch film', projectObjective: 'Build awareness', audience: 'Young adults', intendedOutputs: 'Hero film',
      timelineBand: '1-2-months', budgetBand: '20k-50k', referencesStatus: 'skipped' as const, contactEmail: 'hello@example.com'
    }]
  ])('derives %i completed intake stages from canonical values', (expected, values) => {
    expect(getCompletedIntakeStageCount({ ...createDefaultLeadDraft(), ...values })).toBe(expected);
  });

  test('does not complete references-contact without both a reference decision and contact route', () => {
    const prior = {
      ...createDefaultLeadDraft(),
      projectScope: 'Launch film', projectObjective: 'Build awareness', audience: 'Young adults', intendedOutputs: 'Hero film',
      timelineBand: '1-2-months', budgetBand: '20k-50k'
    };
    expect(getCompletedIntakeStageCount({ ...prior, referencesStatus: 'skipped' })).toBe(3);
    expect(getCompletedIntakeStageCount({ ...prior, contactName: 'Jayden' })).toBe(3);
  });
});

describe('intake stage recaps', () => {
  test('formats the completed project stage from original canonical wording', () => {
    expect(formatIntakeStageRecap('project', {
      ...createDefaultLeadDraft(),
      projectScope: 'A launch film for the new chair',
      projectObjective: 'Build awareness',
      scopePolished: 'A polished chair campaign'
    })).toBe('So far: A launch film for the new chair; objective: Build awareness.');
  });

  test('formats audience and planning stages without inferred facts', () => {
    expect(formatIntakeStageRecap('audience', {
      ...createDefaultLeadDraft(),
      audience: 'Young adults',
      intendedOutputs: 'Hero film and cut-downs'
    })).toBe('So far: audience: Young adults; intended outputs: Hero film and cut-downs.');
    expect(formatIntakeStageRecap('planning', {
      ...createDefaultLeadDraft(),
      timelineBand: 'Not sure yet',
      budgetBand: 'Prefer not to share'
    })).toBe('So far: timeline: Not sure yet; budget: Prefer not to share.');
  });

  test('omits absent fields and keeps referencesStatus factual', () => {
    expect(formatIntakeStageRecap('project', {
      ...createDefaultLeadDraft(),
      projectObjective: 'Build awareness',
      scopePolished: 'Never substitute this'
    })).toBe('So far: objective: Build awareness.');
    expect(formatIntakeStageRecap('references-contact', {
      ...createDefaultLeadDraft(),
      referencesStatus: 'skipped',
      contactEmail: 'hello@example.com'
    })).toBe('So far: references: Skipped; contact email: hello@example.com.');
    expect(formatIntakeStageRecap('references-contact', createDefaultLeadDraft())).toBeNull();
  });

  test('caps displayed canonical values at the server field limit', () => {
    const recap = formatIntakeStageRecap('project', {
      ...createDefaultLeadDraft(),
      projectScope: 'x'.repeat(220)
    });
    expect(recap).toBe(`So far: ${'x'.repeat(200)}.`);
  });
});
