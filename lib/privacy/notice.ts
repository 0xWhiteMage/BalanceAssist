export const CONSENT_VERSION = '1.0';

export const DATA_USE_NOTICE_COPY = {
  title: 'Data Use Notice',
  body: 'Balance Assist is Balance Studio\'s AI assistant for project enquiries and studio questions. Your same-browser temporary draft is kept for up to 24 hours. If you approve sharing, your details may be sent to the Balance team in Telegram. You can ask us to delete your project data anytime.',
  acknowledgeButton: 'I understand',
  privacyLink: '/privacy',
  privacyLinkLabel: 'Privacy details'
} as const;

export interface ConsentRecord {
  consentedAt: string;
  consentVersion: string;
}
