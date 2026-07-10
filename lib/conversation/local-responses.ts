import type { LeadDraft } from '@/lib/onboarding/types';
import type { ConversationStepId } from '@/lib/conversation/types';

type LocalIntent = {
  patterns: RegExp[];
  response: string | ((ctx: ConversationContext) => string);
};

type ConversationContext = {
  draft: LeadDraft;
  step: ConversationStepId;
  isTeamConnected: boolean;
};

function getNextMissingFieldPrompt(draft: LeadDraft): string {
  if (!draft.projectScope.trim()) return 'Tell me a bit about the project you want to create.';
  if (!(draft.projectType ?? '').trim() && !draft.service) return 'What type of creative output are you looking for — for example 2D animation, motion graphics, or a brand film?';
  if (!draft.timelineBand) return 'What timeline are you working with?';
  if (!draft.budgetBand) return 'What budget range are you working with?';
  if (!draft.contactName.trim()) return 'What name should I put on the brief?';
  if (!draft.contactEmail.trim()) return 'What email should the Balance team use to follow up?';
  return 'Would you like to approve the brief for the team or continue refining it?';
}

function hasAnyProjectContext(draft: LeadDraft) {
  return Boolean(
    draft.projectScope.trim() ||
      (draft.projectType ?? '').trim() ||
      draft.service ||
      draft.timelineBand ||
      draft.budgetBand ||
      draft.contactName.trim() ||
      draft.contactEmail.trim() ||
      (draft.contactCompany ?? '').trim()
  );
}

const intents: LocalIntent[] = [
  {
    patterns: [/what.*do.*you.*remember|what.*have.*i.*shared|what.*do.*you.*know.*about.*my.*project/i],
    response: (ctx) => {
      const d = ctx.draft;
      const parts: string[] = [];
      if (d.service) parts.push(`Service: ${d.service.replace(/-/g, ' ')}`);
      if (d.projectScope) parts.push(`Project scope: ${d.projectScope}`);
      if (d.timelineBand) parts.push(`Timeline: ${d.timelineBand.replace(/-/g, ' ')}`);
      if (d.budgetBand) parts.push(`Budget: ${d.budgetBand.replace(/-/g, ' ')}`);
      if (d.contactName) parts.push(`Name: ${d.contactName}`);
      if (d.contactEmail) parts.push(`Email: ${d.contactEmail}`);
      const company = (d as Record<string, unknown>).contactCompany;
      if (company) parts.push(`Company: ${company}`);

      if (parts.length === 0) {
        return "I haven't captured any details yet. Tell me about your project and I'll keep track of everything you share.";
      }
      return `Here's what I've captured so far:\n\n${parts.map((p) => `\u2022 ${p}`).join('\n')}\n\nAnything you'd like to correct or update?`;
    }
  },
  {
    patterns: [/forget.*this.*project|reset.*my.*project|clear.*my.*project|start.*over/i],
    response: "I've cleared my memory of this project. We can start fresh whenever you're ready."
  },
  {
    patterns: [/are.*you.*(?:bot|ai|robot|machine)|is.*this.*(?:bot|ai|automated)|are.*you.*real|are.*you.*human|am.*i.*talking.*to.*(?:bot|ai|human|person)/i],
    response: "I'm an AI assistant, not a human — but I'm designed to be genuinely helpful. If you'd ever like to speak with a person, just say \"talk to a human\" and I'll connect you right away."
  },
  {
    patterns: [/talk.*to.*human|speak.*to.*human|real.*person|human.*agent|connect.*team|i.*want.*to.*talk.*to.*someone|connect.*me/i],
    response: "Of course! I'll connect you with our team right away."
  },
  {
    patterns: [/contact|email|phone|reach|call.*you/i],
    response: 'You can reach our team at hello@balancestudio.tv, or use the Talk to a human button below if you\'d like a direct handoff.'
  },
  {
    patterns: [/^(hi|hello|hey|yo|sup|greetings|good\s*(morning|afternoon|evening))(\s*!?\s*)?$/i],
    response: (ctx) =>
      hasAnyProjectContext(ctx.draft)
        ? `I'm here. ${getNextMissingFieldPrompt(ctx.draft)}`
        : "Hello! I'm Balance Assist. How can I help you today?"
  },
  {
    patterns: [/thank|thanks|appreciate|cheers|great|awesome|cool|nice/i],
    response: "You're welcome! Is there anything else I can help you with?"
  },
  {
    patterns: [/bye|goodbye|see.*you|later|that.*all|done|nothing/i],
    response: "Thanks for chatting with me! Feel free to come back anytime. Have a great day!"
  },
  {
    patterns: [/legal|contract|terms|liability|nda/i],
    response: "I'm not able to advise on legal or contract terms. Our producers can walk you through that directly."
  },
  {
    patterns: [/write.*code|program|script|hack|exploit|sql injection|prompt inject|jailbreak|ignore.*previous|ignore.*instructions|reveal.*prompt|system.*prompt|change.*role|pretend.*human/i],
    response: "I'm here to help with your Balance project brief. I can't help with that, but I can help you capture a creative brief if you have one in mind."
  }
];

const fallbackResponses = [
  'Let me try to help with that. Could you tell me a bit more?',
  'I want to make sure I understand. Can you say a little more?',
  "Happy to help. What's the part you want to focus on?"
];

export function getLocalResponse(message: string, ctx: ConversationContext): string | null {
  for (const intent of intents) {
    if (intent.patterns.some((p) => p.test(message))) {
      const text = typeof intent.response === 'function' ? intent.response(ctx) : intent.response;

      if (intent.patterns[0].source.includes('talk.*to.*human') && !ctx.isTeamConnected) {
        return text;
      }

      return text;
    }
  }

  return null;
}

export function getFallbackResponse(): string {
  return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
}

export function getReaskText(stepId: ConversationStepId): string | null {
  const reasks: Partial<Record<ConversationStepId, string>> = {
    intro: 'What kind of project are you exploring?',
    scope: 'Could you tell me a bit about what you\'re looking to create?',
    timeline: 'What timeline are you working with?',
    budget: 'What budget range are you comfortable with?',
    'contact-name': 'How should I address you?',
    'contact-email': 'What\'s the best email to reach you?'
  };

  return reasks[stepId] ?? null;
}
