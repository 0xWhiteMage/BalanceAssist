export const CONSENT_VERSION = '1.0';

export const DATA_USE_NOTICE_COPY = {
  title: 'Data Use Notice',
  body: 'Balance Assist is an AI assistant by Balance Studio. It uses AI to help with your project brief. Your conversation may be reviewed by the Balance team via Telegram to assist you. We store your brief details to follow up. You can ask us to delete your data anytime.',
  acknowledgeButton: 'I understand',
  privacyLink: '/privacy'
} as const;

export interface ConsentRecord {
  consentedAt: string;
  consentVersion: string;
}
