import { DATA_USE_NOTICE_COPY } from '@/lib/privacy/notice';

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '3rem 1.5rem',
        fontFamily: '"Futura PT", Arial, sans-serif',
        color: '#f2f2f2',
        background: '#101010',
        minHeight: '100vh'
      }}
    >
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>{DATA_USE_NOTICE_COPY.title}</h1>
      <p style={{ lineHeight: 1.6, fontSize: '0.95rem', whiteSpace: 'pre-line' }}>
        {DATA_USE_NOTICE_COPY.body}
      </p>
      <h2 style={{ fontSize: '1.1rem', margin: '2rem 0 0.5rem' }}>Separate choices</h2>
      <p style={{ lineHeight: 1.6, fontSize: '0.95rem' }}>
        AI analysis, human contact, and producer transfer are separate consent scopes. AI analysis sends AI-mode messages and relevant temporary context to DeepSeek. Human contact sends only your typed message through the Telegram relay. Files requested by a producer require a separate producer-transfer choice, are stored temporarily in private Supabase storage, and are made available to the Balance team through time-limited links. Producer transfer also sends the approved brief to the Balance team and may queue the approved CRM projection for Monday.com.
      </p>
      <h2 style={{ fontSize: '1.1rem', margin: '2rem 0 0.5rem' }}>Temporary data and feedback</h2>
      <p style={{ lineHeight: 1.6, fontSize: '0.95rem' }}>
        Temporary sessions expire 24 hours after the latest meaningful activity. After producer transfer, qualified CRM records are reviewed after 90 days and have a 30-day overdue grace period; needs-review, misfit, and unqualified records are queued for cleanup after 30 days. Optional clarity feedback is a bounded yes or not-quite response with no comment box. Operational logs use allowlisted fields; provider messages, downstream copies, and backups follow their own retention and deletion controls.
      </p>
      <h2 style={{ fontSize: '1.1rem', margin: '2rem 0 0.5rem' }}>Deletion and contact</h2>
      <p style={{ lineHeight: 1.6, fontSize: '0.95rem' }}>
        You can request deletion from the widget. Requested, processing, or failed states do not mean deletion is complete. For privacy questions or downstream deletion requests, use the human-contact route or Balance Studio&apos;s published website contact details.
      </p>
    </main>
  );
}
