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
    patterns: [/what.*your.*name|who.*are.*you|what.*are.*you.*called|your.*name/i],
    response: "I'm **Balance Assist** — Balance Studio's intelligent AI agent. I help guide project inquiries, answer questions about our services, and connect you with the right people on our team."
  },
  {
    patterns: [/are.*you.*(?:bot|ai|robot|machine)|is.*this.*(?:bot|ai|automated)|are.*you.*real|are.*you.*human|am.*i.*talking.*to.*(?:bot|ai|human|person)/i],
    response: "I'm an AI assistant, not a human — but I'm designed to be genuinely helpful. If you'd ever like to speak with a person, just say \"talk to a human\" and I'll connect you right away."
  },
  {
    patterns: [/what.*model|which.*model|what.*llm|are.*you.*gpt|are.*you.*chatgpt|are.*you.*claude|what.*ai.*model/i],
    response: "I'm Balance Assist, the AI assistant supporting Balance Studio's project intake and handoff flow. My job is to help gather the brief clearly and route it to the right human producer."
  },
  {
    patterns: [/what.*can.*you.*do|how.*does.*this.*work|what.*do.*you.*do|how.*can.*you.*help|help.*me.*with/i],
    response: "I can help you:\n\n• Explore our services and figure out what fits your project\n• Capture your project brief — scope, timeline, budget\n• Share files or references with our team\n• Connect you with the right person for a call or chat\n\nWhat would you like to start with?"
  },
  {
    patterns: [/what.*services|what.*do.*you.*offer|what.*do.*you.*guys.*do|tell.*me.*about.*(?:your|balance).*(?:services|work)/i],
    response: "Balance Studio offers:\n\n• **Production** — End-to-end film and video production\n• **Post-Production** — Editing, color, sound, finishing\n• **Event & Experience** — Immersive event coverage\n• **Media Asset Adaptation** — Content optimization across channels\n• **Design & Direction** — Art direction and visual systems\n• **Generative AI** — AI-assisted workflows\n\nWhich of these interests you?"
  },
  {
    patterns: [/talk.*to.*human|speak.*to.*human|real.*person|human.*agent|connect.*team|i.*want.*to.*talk.*to.*someone|connect.*me/i],
    response: "Of course! I'll connect you with our team right away."
  },
  {
    patterns: [/where.*based|where.*located|where.*are.*you|what.*country|singapore/i],
    response: "Balance Studio is based in Singapore. We work with clients across Asia Pacific and beyond."
  },
  {
    patterns: [/contact|email|phone|reach|call.*you/i],
    response: "You can reach our team at hello@balancestudio.tv, or I can connect you directly through this chat. Would you like me to arrange that?"
  },
  {
    patterns: [/^(hi|hello|hey|yo|sup|greetings|good\s*(morning|afternoon|evening))(\s*!?\s*)?$/i],
    response: "Hello! I'm Balance Assist. How can I help you today?"
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
    patterns: [/portfolio|examples|previous.*work|case.*stud/i],
    response: "You can explore our portfolio at balancestudio.tv. Would you like me to connect you with our team to discuss a specific project?"
  },
  {
    patterns: [/timeline|how.*long|turnaround|delivery/i],
    response: "Timelines vary depending on the project scope. Typically, we work in ranges from a few weeks for focused projects to several months for larger campaigns."
  },
  {
    patterns: [/how much|what.*price|quote|cost|fees?|rates?/i],
    response: "Final pricing is set by our producers after understanding scope. I can't quote from here, but I can pass this to the team."
  },
  {
    patterns: [/legal|contract|terms|liability|nda/i],
    response: "I'm not able to advise on legal or contract terms. Our producers can walk you through that directly."
  },
  {
    patterns: [/apply.*job|looking.*for.*job|need.*a.*job|hire.*me|recruit|career|vacancy|job.*opening|subscribe|sign.*in|password|login/i],
    response: "I'm Balance Assist and I only help with creative production briefs for the Balance team. For other requests, please contact hello@balancestudio.tv."
  },
  {
    patterns: [/write.*code|program|script|hack|exploit|sql injection|prompt inject|jailbreak|ignore.*previous|ignore.*instructions|reveal.*prompt|system.*prompt|change.*role|pretend.*human/i],
    response: "I'm here to help with your Balance project brief. I can't help with that, but I can help you capture a creative brief if you have one in mind."
  }
];

const fallbackResponses = [
  "That's a good question! I'm best at helping with project inquiries — would you like to tell me about your project?",
  "I appreciate that! I'm still learning, but I can definitely help you explore services or connect you with our team. What would you prefer?",
  "Great question! Our team would be best equipped to answer that. Would you like me to connect you?",
  "I'm not sure about that, but I can connect you with someone who'd know. Would you like that?"
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
