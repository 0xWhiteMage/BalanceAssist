export const CONSENT_VERSION = '1.2';

export const DATA_USE_NOTICE_COPY = {
  title: 'Choose how to start',
  summary: 'In AI mode, an AI processing service receives each message, relevant temporary brief context, and text extracted from supported files. Use only non-confidential, high-level project details; for NDA-bound, personal, unreleased, or sensitive material, talk to the team without AI. The temporary session expires after 24 hours of inactivity, and nothing is sent to Balance until you separately review and approve the brief.',
  body: 'Build a non-confidential, high-level project brief with Balance Assist, or contact the Balance team without AI. In AI mode, an AI processing service receives each message and relevant temporary draft or extracted file text. Your AI draft is not sent to the Balance team, Telegram, or Monday.com unless you separately approve producer transfer. In team-contact mode, your message is sent to the Balance team through Telegram after you choose that route; it is not sent to an AI processing service or Monday.com. A producer confirms scope, timing, pricing, availability, and contracts. Your same-browser temporary session expires 24 hours after the latest meaningful activity. Approved CRM records have separate retention described in Privacy details. You can request deletion; downstream copies and backups have separate retention controls.',
  aiDisclosure: 'I am Balance Assist, Balance Studio\'s AI brief assistant. An AI processing service processes AI-mode messages and text extracted from supported files. Use this for non-confidential, high-level project information only. For NDA-bound, personal, unreleased, or sensitive material, talk to the team instead.',
  humanDisclosure: 'Messages sent here go to the Balance team through a human-only Telegram relay and are not sent to an AI processing service. Sending a message does not approve a final brief or transfer anything to Monday.com.',
  privacyLink: '/privacy',
  privacyLinkLabel: 'Privacy details'
} as const;

export interface ConsentRecord {
  consentedAt: string;
  consentVersion: string;
}
