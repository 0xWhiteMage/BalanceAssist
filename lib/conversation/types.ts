import type { LeadDraft } from '@/lib/onboarding/types';

export type Sender = 'bot' | 'user';

export type InlineCard =
  | { type: 'calendly'; url: string; label: string; subtitle: string }
  | { type: 'telegram'; url: string; label: string; subtitle: string }
  | { type: 'email'; address: string; label: string; subtitle: string };

export type QuickReply = {
  label: string;
  value: string;
};

export type SharedWorkEntryView = {
  title: string;
  url: string;
  description: string;
  image_url: string;
  category: 'reference' | 'mood' | 'pitch';
  slug: string;
  clients?: string;
  year?: number | null;
};

export type ChatMessage = {
  id: string;
  sender: Sender;
  text: string;
  timestamp: number;
  quickReplies?: QuickReply[];
  inlineCards?: InlineCard[];
  sharedWork?: { entries: SharedWorkEntryView[] };
  attachment?: {
    name: string;
    size: string;
    previewUrl?: string;
    mediaKind?: 'image' | 'video';
  };
  isDisclaimer?: boolean;
  isTeamMessage?: boolean;
  isSystem?: boolean;
  teamDbId?: number;
};

export type ConversationStepId =
  | 'intro'
  | 'scope'
  | 'service'
  | 'timeline'
  | 'budget'
  | 'contact-name'
  | 'contact-email'
  | 'qualification'
  | 'offer-upload'
  | 'upload'
  | 'handoff'
  | 'free-chat';

export type ConversationStep = {
  id: ConversationStepId;
  botMessages: string[] | ((draft: LeadDraft) => string[]);
  quickReplies?: QuickReply[];
  field?: keyof LeadDraft;
  next?: ConversationStepId | ((response: string) => ConversationStepId);
  freeText?: boolean;
  allowAttachment?: boolean;
  inlineCards?: InlineCard[];
};
