import { budgetBandOptions, serviceOptions, timelineBandOptions, type LabeledOption } from '@/lib/onboarding/service-options';
import type { BudgetBandId, LeadDraft, ServiceOptionId, TimelineBandId } from '@/lib/onboarding/types';

export type EssentialFieldKey = keyof Pick<
  LeadDraft,
  'service' | 'projectScope' | 'timelineBand' | 'budgetBand' | 'contactName' | 'contactEmail'
>;

export type EssentialField = {
  key: 'service' | 'projectScope' | 'timelineBand' | 'budgetBand' | 'contactDetails';
  fields: EssentialFieldKey[];
  subfields?: Array<{
    key: EssentialFieldKey;
    label: string;
    input: 'text' | 'email' | 'textarea';
    placeholder?: string;
  }>;
  label: string;
  helper: string;
  display: 'chips' | 'summary';
  input?: 'text' | 'email' | 'textarea' | 'chip-select';
  options?: ReadonlyArray<LabeledOption<ServiceOptionId | TimelineBandId | BudgetBandId>>;
};

export const essentialFields: EssentialField[] = [
  {
    key: 'service',
    fields: ['service'],
    label: 'What type of services are you exploring?',
    helper: 'Select the closest fit for your project.',
    display: 'chips',
    input: 'chip-select',
    options: serviceOptions
  },
  {
    key: 'projectScope',
    fields: ['projectScope'],
    label: 'Project scope',
    helper: 'Tell us what you are planning.',
    display: 'summary',
    input: 'textarea',
    subfields: [
      {
        key: 'projectScope',
        label: 'Project scope',
        input: 'textarea',
        placeholder: 'Describe the project, deliverables, or brief.'
      }
    ]
  },
  {
    key: 'timelineBand',
    fields: ['timelineBand'],
    label: 'Timeline band',
    helper: 'Select your target timeline.',
    display: 'chips',
    input: 'chip-select',
    options: timelineBandOptions
  },
  {
    key: 'budgetBand',
    fields: ['budgetBand'],
    label: 'Budget band',
    helper: 'Select your budget comfort band.',
    display: 'chips',
    input: 'chip-select',
    options: budgetBandOptions
  },
  {
    key: 'contactDetails',
    fields: ['contactName', 'contactEmail'],
    subfields: [
      {
        key: 'contactName',
        label: 'Contact name',
        input: 'text',
        placeholder: 'Your name'
      },
      {
        key: 'contactEmail',
        label: 'Contact email',
        input: 'email',
        placeholder: 'name@company.com'
      }
    ],
    label: 'Contact details',
    helper: 'How can we reach you?',
    display: 'summary',
    input: 'text'
  }
];

export const essentialsOrder = essentialFields.map((field) => field.fields).flat();
