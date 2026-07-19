'use client';

import { useState } from 'react';
import type { TrustFeedbackResponse } from '@/lib/api/contracts';

export function TrustFeedback({
  submitted,
  onSubmit
}: {
  submitted: boolean;
  onSubmit: (response: TrustFeedbackResponse) => Promise<boolean>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function submit(response: TrustFeedbackResponse) {
    if (pending || submitted) return;
    setPending(true);
    setError(false);
    try {
      const saved = await onSubmit(response);
      setError(!saved);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  if (submitted) {
    return <div role="status" className="balance-widget-feedback-confirmation">Feedback saved. Thank you.</div>;
  }

  return (
    <section aria-labelledby="trust-feedback-title" className="balance-widget-feedback">
      <div>
        <p className="balance-widget-feedback-kicker">Optional feedback</p>
        <p id="trust-feedback-title">Did Balance Assist create a clear, useful brief?</p>
        <p>We use this one answer to improve the experience. Your messages are not included.</p>
      </div>
      <div className="balance-widget-feedback-actions">
        <button type="button" className="balance-widget-action" disabled={pending} aria-busy={pending || undefined} onClick={() => void submit('yes')}>Yes, it helped</button>
        <button type="button" className="balance-widget-action" disabled={pending} aria-busy={pending || undefined} onClick={() => void submit('not_quite')}>Needs improvement</button>
      </div>
      {pending && <div role="status">Saving feedback…</div>}
      {error && <div role="alert">Feedback could not be saved. Try again.</div>}
    </section>
  );
}
