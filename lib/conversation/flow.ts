import { budgetBandOptions, serviceOptions, timelineBandOptions } from '@/lib/onboarding/service-options';
import type { LeadDraft } from '@/lib/onboarding/types';
import { getBudgetGuidance } from '@/lib/qualification/budget-matrix';
import { getNextStepCopy } from '@/lib/qualification/next-step';
import { scoreLead } from '@/lib/qualification/score';
import { getTimelineGuidance } from '@/lib/qualification/timeline-matrix';
import type { ConversationStep, ConversationStepId } from './types';

export const conversationSteps: Record<ConversationStepId, ConversationStep> = {
  intro: {
    id: 'intro',
    botMessages: [
      'Hi! I\'m **Balance Assist** — Balance Studio\'s intelligent AI agent.',
      "I can help you explore services, share a project brief, or connect you with the right person on our team.\n\nJust so you know — I'm an AI assistant, not a human. Our team may review our conversation to serve you better.",
      'Tell me about your project, or ask me anything.'
    ],
    freeText: true,
    next: 'scope'
  },

  scope: {
    id: 'scope',
    botMessages: ['Great choice. Tell me a bit about your project — what are you looking to create?'],
    freeText: true,
    field: 'projectScope',
    next: 'service'
  },

  service: {
    id: 'service',
    botMessages: ['What kind of support do you think you need from Balance Studio? If you\'re unsure, just describe it in your own words.'],
    freeText: true,
    next: 'timeline'
  },

  timeline: {
    id: 'timeline',
    botMessages: ['What timeline are you working with? This helps us understand feasibility and planning.'],
    quickReplies: timelineBandOptions.map((o) => ({ label: o.label, value: o.id })),
    field: 'timelineBand',
    next: 'budget'
  },

  budget: {
    id: 'budget',
    botMessages: ['What budget range are you working with? Knowing your budget range helps us suggest realistic formats and timelines.'],
    quickReplies: budgetBandOptions.map((o) => ({ label: o.label, value: o.id })),
    field: 'budgetBand',
    next: 'contact-name'
  },

  'contact-name': {
    id: 'contact-name',
    botMessages: ['Almost there. How should I address you?'],
    freeText: true,
    field: 'contactName',
    next: 'contact-email'
  },

  'contact-email': {
    id: 'contact-email',
    botMessages: ['And what\'s the best email to reach you? This ensures a producer can follow up with the right next steps.'],
    freeText: true,
    field: 'contactEmail',
    next: 'qualification'
  },

  qualification: {
    id: 'qualification',
    botMessages: (draft: LeadDraft) => getQualificationMessages(draft),
    next: 'offer-upload'
  },

  'offer-upload': {
    id: 'offer-upload',
    botMessages: ['Would you like to share any files — a brief, deck, or reference materials?'],
    quickReplies: [
      { label: 'Yes, upload files', value: 'upload' },
      { label: 'No, continue', value: 'skip' }
    ],
    next: (response: string) => (response === 'upload' ? 'upload' : 'handoff')
  },

  upload: {
    id: 'upload',
    botMessages: ['Perfect! Tap the attach button below to upload your files. Our team will review everything you share.'],
    allowAttachment: true,
    next: 'handoff'
  },

  handoff: {
    id: 'handoff',
    botMessages: [
      "Thank you! I've captured everything I need for now.\n\nA producer from the Balance team will review your brief and follow up personally. You can also book a discovery call below if you'd like to talk sooner."
    ],
    inlineCards: [
      {
        type: 'calendly',
        url: 'https://calendly.com/balancestudio/intro-call',
        label: 'Book a Discovery Call',
        subtitle: '30 min · Video call · Pick a time'
      }
    ],
    next: 'free-chat'
  },

  'free-chat': {
    id: 'free-chat',
    botMessages: [],
    freeText: true
  }
};

function getQualificationMessages(draft: LeadDraft): string[] {
  const result = scoreLead(draft);
  const nextStep = getNextStepCopy(result.recommendedNextStep);
  const budget = getBudgetGuidance(draft.budgetBand);
  const timeline = getTimelineGuidance(draft.timelineBand);

  const serviceLabel = serviceOptions.find((s) => s.id === draft.service)?.label ?? 'your project';
  const firstName = draft.contactName.split(' ')[0] || 'there';

  if (result.status === 'qualified') {
    return [
      `Thanks, ${firstName}! Based on what you've shared, ${serviceLabel.toLowerCase()} looks like a great fit for Balance Studio.`,
      `**Your snapshot:**\n• Timeline: ${timeline.label}\n• Budget: ${budget.label}\n• Score: ${result.score}/10`,
      `${timeline.guidance}\n\n${budget.guidance}`,
      `*Indicative only. Final scope, timing, and pricing require human review.*`,
      `I'd recommend: **${nextStep.label}**. Let me connect you with the team.`
    ];
  }

  if (result.status === 'needs_review') {
    return [
      `Thanks for those details, ${firstName}. I'd like our team to review your project personally to give you the best guidance.`,
      `**What I've captured:**\n• Service: ${serviceLabel}\n• Timeline: ${timeline.label}\n• Budget: ${budget.label}`,
      `*Indicative only. Final scope, timing, and pricing require human review.*`
    ];
  }

  if (result.status === 'misfit') {
    return [
      `Thank you, ${firstName}. I appreciate you sharing those details.`,
      `Based on what you've told me, I think our team can help figure out the best path forward — whether that's adjusting scope, timeline, or exploring alternatives.`,
      `*Indicative only. Final scope, timing, and pricing require human review.*`
    ];
  }

  return [
    `Thanks, ${firstName}! I've noted your interest in ${serviceLabel.toLowerCase()}.`,
    `Let me connect you with our team — they'll be able to help you explore options and find the right fit.`,
    `*Indicative only. Final scope, timing, and pricing require human review.*`
  ];
}

export function tryMatchOption(
  text: string,
  step: ConversationStep
): string | null {
  if (!step.quickReplies) return null;

  const normalized = text.toLowerCase().trim();

  for (const reply of step.quickReplies) {
    if (reply.value.toLowerCase() === normalized || reply.label.toLowerCase() === normalized) {
      return reply.value;
    }
  }

  for (const reply of step.quickReplies) {
    if (
      reply.label.toLowerCase().includes(normalized) ||
      normalized.includes(reply.label.toLowerCase())
    ) {
      return reply.value;
    }
  }

  return null;
}

export function getQuickReplyLabel(stepId: ConversationStepId, value: string): string {
  const step = conversationSteps[stepId];
  return step.quickReplies?.find((r) => r.value === value)?.label ?? value;
}
