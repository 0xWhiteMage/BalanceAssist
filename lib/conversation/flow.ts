import type { ConversationStep, ConversationStepId } from './types';

export const conversationSteps: Record<ConversationStepId, ConversationStep> = {
  intro: {
    id: 'intro',
    botMessages: [
      'Hi! I\'m **Balance Assist** — Balance Studio\'s intelligent AI agent.',
      "I can help you explore services, share a project brief, or connect you with the right person on our team.\n\nJust so you know — I'm an AI assistant, not a human. Our team may review our conversation to serve you better.",
      'What can I help you with today? I can answer questions about Balance Studio, help shape a project brief, or connect you with our team if you\'d prefer a human conversation.'
    ],
    freeText: true,
    next: 'scope'
  },

  scope: {
    id: 'scope',
    botMessages: ['Great choice. Tell me a bit about your project — what are you looking to create?'],
    freeText: true,
    field: 'projectScope',
    next: 'objective'
  },

  objective: {
    id: 'objective',
    botMessages: ['What should this project achieve? Not sure yet is a valid answer.'],
    freeText: true,
    field: 'projectObjective',
    next: 'service'
  },

  service: {
    id: 'service',
    botMessages: ['What kind of support do you think you need from Balance Studio? If you\'re unsure, just describe it in your own words.'],
    freeText: true,
    next: 'audience'
  },

  audience: {
    id: 'audience',
    botMessages: ['Who is this for? You can choose Not sure yet or Skip.'],
    freeText: true,
    field: 'audience',
    next: 'outputs'
  },

  outputs: {
    id: 'outputs',
    botMessages: ['What outputs or deliverables do you expect? You can choose Not sure yet or Skip.'],
    freeText: true,
    field: 'intendedOutputs',
    next: 'timeline'
  },

  timeline: {
    id: 'timeline',
    botMessages: ['What timeline are you working with? This helps with planning and feasibility. Not sure yet is a valid answer.'],
    freeText: true,
    field: 'timelineBand',
    next: 'budget'
  },

  budget: {
    id: 'budget',
    botMessages: ['What budget range are you working with? This helps us suggest realistic formats and scope. Prefer not to share is a valid answer.'],
    freeText: true,
    field: 'budgetBand',
    next: 'references'
  },

  references: {
    id: 'references',
    botMessages: ['Would you like to add any references? You can add them now or Skip.'],
    freeText: true,
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
    next: 'consent'
  },

  consent: {
    id: 'consent',
    botMessages: [
      'Just to confirm — is it okay to share this brief with the Balance team? They\'ll use it to prepare for a potential conversation with you.',
      'You can say "yes" to proceed, or "no" if you\'d rather not share it right now.'
    ],
    freeText: true,
    field: 'consentToShare',
    next: 'handoff'
  },

  'offer-upload': {
    id: 'offer-upload',
    botMessages: ['Would you like to share any files — a brief, deck, or reference materials?'],
    freeText: true,
    next: 'handoff'
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
      "Thank you! I've captured everything I need for now.\n\nA producer from the Balance team will review your brief and follow up personally. You can also book a quick catch-up below if you'd like to talk sooner."
    ],
    inlineCards: [
      {
        type: 'calendly',
        url: 'https://calendly.com/haiha-dang/catch-up',
        label: 'Book a catch-up',
        subtitle: '15 min · Pick a time'
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

export function tryMatchOption(
  text: string,
  step: ConversationStep
): string | null {
  if (!step.quickReplies || step.quickReplies.length === 0) return null;

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
