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
        @keyframes approve-pulse {
          0%   { transform: scale(0.96); box-shadow: 0 4px 14px rgba(219, 181, 128, 0.30); filter: brightness(0.94); }
          50%  { transform: scale(1.00); box-shadow: 0 6px 22px rgba(219, 181, 128, 0.55); filter: brightness(1.05); }
          100% { transform: scale(0.96); box-shadow: 0 4px 14px rgba(219, 181, 128, 0.30); filter: brightness(0.94); }
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
