import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataUseNotice } from '@/components/widget/data-use-notice';
import { DATA_USE_NOTICE_COPY, CONSENT_VERSION } from '@/lib/privacy/notice';

describe('DataUseNotice', () => {
  test('renders the data use notice with the correct body text', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByText(DATA_USE_NOTICE_COPY.body)).toBeInTheDocument();
  });

  test('renders the Balance Assist AI title', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByText(DATA_USE_NOTICE_COPY.title)).toBeInTheDocument();
  });

  test('renders an "I understand" button', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    const button = screen.getByTestId('consent-button');
    expect(button).toBeInTheDocument();
    expect(button.textContent).toBe(DATA_USE_NOTICE_COPY.acknowledgeButton);
  });

  test('invokes onConsent with consent record when the button is clicked', () => {
    const onConsent = vi.fn();
    render(<DataUseNotice onConsent={onConsent} />);
    fireEvent.click(screen.getByTestId('consent-button'));
    expect(onConsent).toHaveBeenCalledOnce();
    const record = onConsent.mock.calls[0][0];
    expect(record.consentVersion).toBe(CONSENT_VERSION);
    expect(record.consentedAt).toBeDefined();
  });

  test('hides the consent button after acknowledging', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    fireEvent.click(screen.getByTestId('consent-button'));
    expect(screen.queryByTestId('consent-button')).not.toBeInTheDocument();
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

  test('links to the privacy page for more detail', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', DATA_USE_NOTICE_COPY.privacyLink);
  });

  test('copy does not invite job applications or CV capture', () => {
    render(<DataUseNotice onConsent={() => {}} />);
    expect(screen.getByTestId('data-use-notice').textContent).not.toMatch(/job application|cv|resume/i);
  });
});
