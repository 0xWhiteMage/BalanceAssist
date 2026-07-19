export const CONSENT_VERSION = '1.2';

export const DATA_USE_NOTICE_COPY = {
  title: 'Choose how to start',
  summary: 'Build a non-confidential project brief with AI, or speak directly with the Balance team. Nothing is shared with the team until you choose to send it.',
  body: 'An AI processing service receives each AI-mode message, relevant temporary brief context, and text extracted from supported files. Use only non-confidential, high-level project details. Team-contact mode sends only the message you choose to share with the Balance team and does not use AI. The temporary session expires 24 hours after the latest meaningful activity.',
  privacy: 'Your AI draft stays separate from the Balance team until you separately review and approve the brief. Approved briefs and team-contact messages may be copied to the services Balance uses to respond and manage enquiries, with separate retention controls. You can request deletion, subject to downstream copies and backups.',
  aiDisclosure: 'I am Balance Assist, Balance Studio\'s AI brief assistant. An AI processing service processes AI-mode messages and text extracted from supported files. Use this for non-confidential, high-level project information only. For NDA-bound, personal, unreleased, or sensitive material, talk to the team instead.',
  humanDisclosure: 'Messages sent here go directly to the Balance team and are not sent to an AI processing service. Sending a message does not approve or transfer an AI brief.',
  privacyLink: '/privacy',
  privacyLinkLabel: 'Privacy details'
} as const;

export interface ConsentRecord {
  consentedAt: string;
  consentVersion: string;
}
