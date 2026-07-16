export const CONSENT_VERSION = '1.1';

export const DATA_USE_NOTICE_COPY = {
  title: 'Choose how to start',
  body: 'Build a non-confidential, high-level project brief with Balance Assist, or talk directly with the Balance team. AI mode uses DeepSeek to process messages and text extracted from supported files. A producer confirms scope, timing, pricing, availability, and contracts. Your same-browser temporary draft is kept for up to 24 hours. Nothing is sent to the Balance team, Telegram, or Monday.com until you explicitly approve transfer. You can request deletion; downstream copies and backups are handled separately.',
  aiDisclosure: 'I am Balance Assist, Balance Studio\'s AI brief assistant. DeepSeek processes AI-mode messages and text extracted from supported files. Use this for non-confidential, high-level project information only. For NDA-bound, personal, unreleased, or sensitive material, talk to the team instead.',
  humanDisclosure: 'Messages sent here go to the Balance team through a private relay. Sending a message does not approve a final brief or transfer anything to Monday.',
  privacyLink: '/privacy',
  privacyLinkLabel: 'Privacy details'
} as const;

export interface ConsentRecord {
  consentedAt: string;
  consentVersion: string;
}
