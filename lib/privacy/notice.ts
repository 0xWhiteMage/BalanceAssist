export const CONSENT_VERSION = '1.1';

export const DATA_USE_NOTICE_COPY = {
  title: 'Data Use Notice',
  body: 'Balance Assist is Balance Studio\'s AI assistant for project enquiries and studio questions. Your same-browser temporary draft is kept for up to 24 hours. Nothing is sent to the Balance team, Telegram, or Monday.com until you explicitly approve transfer. Files you choose for analysis are private, used only to analyse this draft, and are never sent to Telegram, Monday.com, or the team. You can ask us to delete your project data anytime; the deletion request status is tracked and processed within 24 hours. We cannot immediately remove content already transferred to Telegram, Monday.com, or provider backups.',
  acknowledgeButton: 'I understand',
  privacyLink: '/privacy',
  privacyLinkLabel: 'Privacy details'
} as const;

export interface ConsentRecord {
  consentedAt: string;
  consentVersion: string;
}
