import { WidgetOverlay } from '@/components/widget/widget-overlay';

export default function PreviewPage() {
  const calendlyUrl = process.env.CALENDLY_URL;

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <iframe
        src="https://www.balancestudio.tv"
        title="Balance Studio"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none'
        }}
      />
      <style>{`
        @keyframes balance-assist-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes approve-confirm {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <WidgetOverlay autoOpen={true} calendlyUrlOverride={calendlyUrl} />
    </div>
  );
}
