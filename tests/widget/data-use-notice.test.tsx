import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { DataUseNotice } from '@/components/widget/data-use-notice';
import { brandTokens } from '@/lib/brand-tokens';
import { DATA_USE_NOTICE_COPY, CONSENT_VERSION } from '@/lib/privacy/notice';

describe('DataUseNotice', () => {
  const entryActionContract = {
    width: '100%',
    minHeight: '44px',
    padding: '10px 16px',
    borderRadius: '20px',
    background: 'transparent',
    fontWeight: '600'
  };

  function contrastRatio(foreground: string, background: string) {
    function luminance(hex: string) {
      const channels = hex.match(/[a-f\d]{2}/gi)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
      const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }

    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  }

  function renderNotice(overrides: Partial<ComponentProps<typeof DataUseNotice>> = {}) {
    const props = {
      onConsent: vi.fn(),
      onHuman: vi.fn(),
      onLeave: vi.fn(),
      ...overrides
    };
    return { ...render(<DataUseNotice {...props} />), ...props };
  }

  function expectEqualEntryActions(names: string[]) {
    const actions = names.map((name) => screen.getByRole('button', { name }));

    for (const action of actions) {
      expect(action).toHaveClass('balance-entry-action');
      expect(action).toBeEnabled();
      expect(action.tagName).toBe('BUTTON');
      expect(action).toHaveAttribute('type', 'button');
      expect(action.style).toMatchObject(entryActionContract);
      expect(action).toHaveStyle({
        borderColor: brandTokens.colors.warmGold,
        borderStyle: 'solid',
        borderWidth: '1px'
      });
    }

    expect(actions.every((action) => action.classList.contains('balance-entry-action'))).toBe(true);
  }

  test('keeps the shared boundary above 3:1 against every panel gradient endpoint', () => {
    expect(contrastRatio(brandTokens.colors.warmGold, brandTokens.colors.baseBlack)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(brandTokens.colors.warmGold, brandTokens.colors.charcoal)).toBeGreaterThanOrEqual(3);
  });

  test('renders the data use notice with the correct body text', () => {
    renderNotice();
    expect(screen.getByText(DATA_USE_NOTICE_COPY.body)).toBeInTheDocument();
  });

  test('renders the Balance Assist AI title', () => {
    renderNotice();
    expect(screen.getByText(DATA_USE_NOTICE_COPY.title)).toBeInTheDocument();
  });

  test('gives initial AI, human, and leave actions one exact visual contract', () => {
    renderNotice();

    expectEqualEntryActions(['Build a brief with AI', 'Talk to the team without AI', 'Leave']);
    expect(screen.queryByRole('button', { name: /I understand/i })).not.toBeInTheDocument();
  });

  test('records AI consent through the single informed AI action', () => {
    const onConsent = vi.fn();
    renderNotice({ onConsent });

    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/AI processing service/i);
    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/nothing is sent to Balance until you separately review and approve the brief/i);
    expect(onConsent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Build a brief with AI' }));
    expect(onConsent).toHaveBeenCalledOnce();
    const record = onConsent.mock.calls[0][0];
    expect(record.consentVersion).toBe(CONSENT_VERSION);
    expect(record.consentedAt).toBeDefined();
  });

  test('takes the human path without recording AI consent', () => {
    const onHuman = vi.fn();
    const { onConsent } = renderNotice({ onHuman });

    fireEvent.click(screen.getByRole('button', { name: 'Talk to the team without AI' }));
    expect(onHuman).toHaveBeenCalledOnce();
    expect(onConsent).not.toHaveBeenCalled();
  });

  test('leaves through the required leave action', () => {
    const onLeave = vi.fn();
    renderNotice({ onLeave });

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    expect(onLeave).toHaveBeenCalledOnce();
  });

  test('includes data-testid="data-use-notice" on the wrapper', () => {
    renderNotice();
    expect(screen.getByTestId('data-use-notice')).toBeInTheDocument();
  });

  test('discloses the 24-hour temporary draft period without promising follow-up storage', () => {
    renderNotice();

    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/temporary session expires 24 hours after the latest meaningful activity/i);
    expect(screen.getByTestId('data-use-notice').textContent).not.toMatch(/follow up/i);
  });

  test('discloses deletion status, its 24-hour SLA, and external-copy limits', () => {
    renderNotice();
    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/request deletion/i);
    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/backups/i);
  });

  test('names Monday.com as a recipient of an approved project transfer', () => {
    renderNotice();

    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/monday\.com/i);
    expect(CONSENT_VERSION).toBe('1.2');
  });

  test('distinguishes AI session processing from team-contact relay delivery', () => {
    renderNotice();

    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/AI processing service receives each message and relevant temporary draft or extracted file text/i);
    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/team-contact mode.*message.*Balance team through Telegram/i);
  });

  test('links to the privacy page for more detail', () => {
    renderNotice();
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', DATA_USE_NOTICE_COPY.privacyLink);
  });

  test('copy does not invite job applications or CV capture', () => {
    renderNotice();
    expect(screen.getByTestId('data-use-notice').textContent).not.toMatch(/job application|cv|resume/i);
  });

  test('describes the AI processing service without a customer-visible vendor name and preserves the human-only route', () => {
    renderNotice();
    const notice = screen.getByTestId('data-use-notice');
    expect(notice).toHaveTextContent(/AI processing service receives each message/i);
    expect(notice).toHaveTextContent(/non-confidential, high-level project brief/i);
    expect(screen.getByRole('button', { name: 'Talk to the team without AI' })).toBeInTheDocument();
    expect(notice.textContent).not.toMatch(/DeepSeek|MiniMax|OpenAI|fallback provider/i);
  });
});
