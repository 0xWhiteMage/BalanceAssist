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
    return <div role="status" style={{ padding: '0 16px 16px', fontSize: 12 }}>Thanks for the feedback.</div>;
  }

  return (
    <section aria-labelledby="trust-feedback-question" style={{ display: 'grid', gap: 8, padding: '0 16px 16px' }}>
      <p id="trust-feedback-question" style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>Was this clear?</p>
      <p style={{ margin: 0, fontSize: 11, opacity: 0.72 }}>Only this choice is recorded, not your messages.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button type="button" className="balance-widget-action" disabled={pending} aria-busy={pending || undefined} onClick={() => void submit('yes')}>Yes</button>
        <button type="button" className="balance-widget-action" disabled={pending} aria-busy={pending || undefined} onClick={() => void submit('not_quite')}>Not quite</button>
      </div>
      {pending && <div role="status">Saving feedback</div>}
      {error && <div role="alert">Feedback was not saved. Please try again.</div>}
    </section>
  );
}
