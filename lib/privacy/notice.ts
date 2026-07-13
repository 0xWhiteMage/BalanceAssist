export const CONSENT_VERSION = '1.0';

export const DATA_USE_NOTICE_COPY = {
  title: 'Data Use Notice',
  body: 'Balance Assist is Balance Studio\'s AI assistant for project enquiries and studio questions. If you continue, AI may help shape your brief, approved details may be shared with the Balance team in Telegram, and any later Calendly handoff is verified before we claim the team received it. We store your brief details so we can follow up, and you can ask us to delete them anytime.',
  acknowledgeButton: 'I understand',
  privacyLink: '/privacy',
  privacyLinkLabel: 'Privacy details'
} as const;

export interface ConsentRecord {
  consentedAt: string;
  consentVersion: string;
}
