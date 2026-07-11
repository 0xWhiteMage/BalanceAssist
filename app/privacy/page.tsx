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
    </main>
  );
}
