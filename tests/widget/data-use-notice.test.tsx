import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  function expectEqualEntryActions(names: string[]) {
    const actions = names.map((name) => screen.getByRole('button', { name }));

    for (const action of actions) {
      expect(action).toHaveClass('balance-entry-action');
      expect(action).toBeEnabled();
      expect(action.tagName).toBe('BUTTON');
      expect(action).toHaveAttribute('type', 'button');
      expect(action.style).toMatchObject(entryActionContract);
    }

    expect(new Set(actions.map((action) => action.className))).toEqual(new Set(['balance-entry-action']));
    expect(new Set(actions.map((action) => action.style.cssText))).toHaveLength(1);
    expect(actions[0].style.border).toBe(`1px solid ${brandTokens.colors.border}`);
  }

  test('renders the data use notice with the correct body text', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByText(DATA_USE_NOTICE_COPY.body)).toBeInTheDocument();
  });

  test('renders the Balance Assist AI title', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByText(DATA_USE_NOTICE_COPY.title)).toBeInTheDocument();
  });

  test('gives initial AI, human, and leave actions one exact visual contract', () => {
    render(<DataUseNotice onConsent={() => {}} />);

    expectEqualEntryActions(['Build a brief with AI', 'Talk to the team without AI', 'Leave']);
    expect(screen.queryByRole('button', { name: /I understand/i })).not.toBeInTheDocument();
  });

  test('keeps the exact visual contract after opening the AI disclosure', () => {
    render(<DataUseNotice onConsent={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Build a brief with AI' }));

    expectEqualEntryActions(['Continue with AI', 'Talk to the team without AI', 'Leave']);
  });

  test('records AI consent only after Continue with AI', () => {
    const onConsent = vi.fn();
    render(<DataUseNotice onConsent={onConsent} />);

    fireEvent.click(screen.getByRole('button', { name: 'Build a brief with AI' }));
    expect(screen.getByText(/DeepSeek processes AI-mode messages/i)).toBeInTheDocument();
    expect(onConsent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with AI' }));
    expect(onConsent).toHaveBeenCalledOnce();
    const record = onConsent.mock.calls[0][0];
    expect(record.consentVersion).toBe(CONSENT_VERSION);
    expect(record.consentedAt).toBeDefined();
  });

  test('takes the human path without recording AI consent', () => {
    const onConsent = vi.fn();
    const onHuman = vi.fn();
    render(<DataUseNotice onConsent={onConsent} onHuman={onHuman} />);

    fireEvent.click(screen.getByRole('button', { name: 'Talk to the team without AI' }));
    expect(onHuman).toHaveBeenCalledOnce();
    expect(onConsent).not.toHaveBeenCalled();
  });

  test('includes data-testid="data-use-notice" on the wrapper', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByTestId('data-use-notice')).toBeInTheDocument();
  });

  test('discloses the 24-hour temporary draft period without promising follow-up storage', () => {
    render(<DataUseNotice onConsent={vi.fn()} />);

    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/temporary draft.*24 hours/i);
    expect(screen.getByTestId('data-use-notice').textContent).not.toMatch(/follow up/i);
  });

  test('discloses deletion status, its 24-hour SLA, and external-copy limits', () => {
    render(<DataUseNotice onConsent={vi.fn()} />);
    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/request deletion/i);
    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/backups/i);
  });

  test('names Monday.com as a recipient of an approved project transfer', () => {
    render(<DataUseNotice onConsent={vi.fn()} />);

    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/monday\.com/i);
    expect(CONSENT_VERSION).toBe('1.1');
  });

  test('distinguishes AI session processing from team-contact relay delivery', () => {
    render(<DataUseNotice onConsent={vi.fn()} />);

    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/AI stays in this temporary session pending producer-transfer approval/i);
    expect(screen.getByTestId('data-use-notice')).toHaveTextContent(/team contact.*relay message.*Balance Assist team/i);
  });

  test('links to the privacy page for more detail', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', DATA_USE_NOTICE_COPY.privacyLink);
  });

  test('copy does not invite job applications or CV capture', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByTestId('data-use-notice').textContent).not.toMatch(/job application|cv|resume/i);
  });
});
