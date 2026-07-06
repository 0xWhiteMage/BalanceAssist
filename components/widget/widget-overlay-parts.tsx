import Image from 'next/image';
import { TypingDots } from '@/components/chat/typing-dots';
import { brandTokens } from '@/lib/brand-tokens';
import { HUMAN_UPLOAD_GUIDANCE } from '@/lib/uploads/file-policy';

export const balanceLogoUrl =
  'https://images.squarespace-cdn.com/content/v1/5c81167bab1a62362b828e3f/d5e257d2-800b-4f0b-82e4-edfabe552823/gold.png?format=2500w';

export function WidgetOverlayHeader({
  isTeamConnected,
  onClose
}: {
  isTeamConnected: boolean;
  onClose: () => void;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`,
        flexShrink: 0,
        background: 'rgba(16, 16, 16, 0.6)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <Image
            src={balanceLogoUrl}
            alt="Balance logo"
            width={18}
            height={18}
            unoptimized
            style={{ objectFit: 'contain', filter: 'brightness(0) saturate(100%)' }}
          />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: brandTokens.colors.lightText, letterSpacing: '0.02em' }}>
            {isTeamConnected ? 'Balance Studio Team' : 'Balance Assist'}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: '10px',
              color: isTeamConnected ? '#4ade80' : brandTokens.colors.warmGold,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
            {isTeamConnected ? 'Team connected' : 'Online'}
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          color: brandTokens.colors.mutedText,
          cursor: 'pointer',
          fontSize: '16px',
          padding: '4px 8px',
          lineHeight: 1
        }}
        aria-label="Close chat"
      >
        &#10005;
      </button>
    </header>
  );
}

export function BotAvatarSmall() {
  return (
    <div
      style={{
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <Image
        src={balanceLogoUrl}
        alt="Balance logo"
        width={14}
        height={14}
        unoptimized
        style={{ objectFit: 'contain', filter: 'brightness(0) saturate(100%)' }}
      />
    </div>
  );
}

export function TeamTypingIndicator() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
      <span
        style={{
          marginLeft: '4px',
          fontSize: '10px',
          fontWeight: 600,
          color: brandTokens.colors.warmGold,
          textTransform: 'uppercase',
          letterSpacing: '0.16em'
        }}
      >
        Balance Studio Team
      </span>
      <TypingDots />
    </div>
  );
}

export function FileRequestBanner({ note }: { note: string | null }) {
  return (
    <div
      style={{
        border: `1px solid ${brandTokens.colors.border}`,
        background: 'rgba(219, 181, 128, 0.06)',
        borderRadius: '10px',
        padding: '10px 12px',
        fontSize: '12px',
        lineHeight: 1.6,
        color: brandTokens.colors.lightText,
        maxWidth: '280px'
      }}
    >
      <div style={{ fontSize: '10px', fontWeight: 600, color: brandTokens.colors.warmGold, textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: '4px' }}>
        File request from team
      </div>
      <div style={{ marginBottom: '6px' }}>
        {note ?? 'The team asked you to upload files for this project.'}
      </div>
      <div style={{ fontSize: '11px', color: brandTokens.colors.mutedText }}>
        Tap the paperclip icon on the left of the message box below to attach your files.
      </div>
      <div style={{ marginTop: '6px', fontSize: '10px', color: brandTokens.colors.mutedText }}>
        {HUMAN_UPLOAD_GUIDANCE}
      </div>
    </div>
  );
}

export function FileRequestInputHint() {
  return (
    <div
      style={{
        padding: '6px 14px',
        background: 'rgba(219, 181, 128, 0.08)',
        borderTop: `1px solid ${brandTokens.colors.subtleBorder}`,
        fontSize: '10px',
        fontWeight: 600,
        color: brandTokens.colors.warmGold,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: brandTokens.colors.warmGold,
          display: 'inline-block'
        }}
      />
      File upload ready · use the paperclip icon
    </div>
  );
}

export function UploadPolicyModal({ onClose }: { onClose: () => void }) {
  const groups = [
    ['Documents', 'pdf, ppt, pptx, key, doc, docx, pages, xls, xlsx, txt, csv'],
    ['Images', 'jpg, png, gif, svg, tif, webp, heic, psd, ai, eps, indd'],
    ['Video / Audio', 'mp4, mov, avi, mkv, webm, mp3, wav, flac, m4a, aiff'],
    ['Project files', 'aep, prproj, drp, drpx, fcpxml, sketch, fig, xd'],
    ['Archives / Fonts', 'zip, rar, 7z, tar, gz, ttf, otf, woff, woff2']
  ];

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 120,
        background: 'rgba(0,0,0,0.68)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '340px',
          maxHeight: '80vh',
          overflowY: 'auto',
          borderRadius: '14px',
          border: `1px solid ${brandTokens.colors.border}`,
          background: brandTokens.gradients.panel,
          color: brandTokens.colors.lightText,
          padding: '18px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: brandTokens.colors.warmGold }}>
              Accepted files
            </div>
            <div style={{ marginTop: '4px', fontSize: '14px', fontWeight: 600 }}>Upload guidelines</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: brandTokens.colors.mutedText, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}
            aria-label="Close upload guidelines"
          >
            ×
          </button>
        </div>

        <p style={{ marginTop: '12px', fontSize: '12px', lineHeight: 1.6, color: brandTokens.colors.mutedText }}>
          {HUMAN_UPLOAD_GUIDANCE}
        </p>

        <div style={{ marginTop: '14px', display: 'grid', gap: '10px' }}>
          {groups.map(([label, list]) => (
            <div key={label} style={{ border: `1px solid ${brandTokens.colors.subtleBorder}`, borderRadius: '10px', padding: '10px 12px', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: brandTokens.colors.warmGold, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                {label}
              </div>
              <div style={{ marginTop: '4px', fontSize: '12px', lineHeight: 1.6 }}>{list}</div>
            </div>
          ))}
        </div>

        <p style={{ marginTop: '12px', fontSize: '11px', lineHeight: 1.6, color: brandTokens.colors.mutedText }}>
          Anything outside these creative-production formats, especially executables and scripts, will be blocked.
        </p>
      </div>
    </div>
  );
}

export function HumanFooter({
  isTeamConnected,
  humanStatus,
  onConnect
}: {
  isTeamConnected: boolean;
  humanStatus: 'idle' | 'connected' | 'delivered' | 'awaiting' | 'replied';
  onConnect: () => void;
}) {
  return (
    <div
      style={{
        padding: '6px 12px 8px',
        flexShrink: 0,
        textAlign: 'center',
        background: 'rgba(16, 16, 16, 0.4)'
      }}
    >
      {!isTeamConnected ? (
        <button
          onClick={onConnect}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            border: `1px solid ${brandTokens.colors.border}`,
            background: 'transparent',
            color: brandTokens.colors.warmGold,
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: brandTokens.typography.condensed,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = brandTokens.colors.warmGold;
            e.currentTarget.style.background = 'rgba(219, 181, 128, 0.06)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = brandTokens.colors.border;
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill={brandTokens.colors.warmGold} />
          </svg>
          Talk to a human
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '10px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color:
                humanStatus === 'replied'
                  ? '#4ade80'
                  : humanStatus === 'awaiting'
                    ? brandTokens.colors.warmGold
                    : brandTokens.colors.mutedText
            }}
          >
            {humanStatus === 'replied' && (
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#4ade80',
                  display: 'inline-block'
                }}
              />
            )}
            {humanStatus === 'awaiting' && (
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: brandTokens.colors.warmGold,
                  display: 'inline-block'
                }}
              />
            )}
            {humanStatus === 'replied'
              ? 'Replied by team'
              : humanStatus === 'awaiting'
                ? 'Awaiting reply'
                : humanStatus === 'delivered'
                  ? 'Message delivered'
                  : 'Connected to team'}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectBriefCard({
  draft,
  showNudge,
  readyForApproval,
  approved,
  onApprove,
  onContinueRefining
}: {
  draft: {
    projectScope: string;
    projectType?: string;
    service: string;
    timelineBand: string;
    budgetBand: string;
    contactName: string;
    contactCompany?: string;
    contactEmail: string;
  };
  showNudge?: boolean;
  readyForApproval?: boolean;
  approved?: boolean;
  onApprove?: () => void;
  onContinueRefining?: () => void;
}) {
  const rows = [
    ['Project scope', draft.projectScope],
    ['Project type', draft.projectType ?? ''],
    ['Service', draft.service],
    ['Timeline', draft.timelineBand],
    ['Budget', draft.budgetBand],
    ['Contact name', draft.contactName],
    ['Company', draft.contactCompany ?? ''],
    ['Email', draft.contactEmail]
  ] as const;

  const completed = rows.filter(([, value]) => value.trim().length > 0).length;

  return (
    <div
      style={{
        border: `1px solid ${brandTokens.colors.border}`,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '12px',
        padding: '12px 14px',
        display: 'grid',
        gap: '8px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: brandTokens.colors.warmGold, textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            Project Brief
          </div>
          <div style={{ marginTop: '3px', fontSize: '12px', color: brandTokens.colors.mutedText }}>
            {completed} of {rows.length} key fields captured
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '6px' }}>
        {rows.map(([label, value]) => {
          const filled = value.trim().length > 0;
          return (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', fontSize: '12px' }}>
              <span style={{ color: brandTokens.colors.mutedText }}>{label}</span>
              <span style={{ color: filled ? brandTokens.colors.lightText : brandTokens.colors.mutedText, textAlign: 'right', maxWidth: '60%' }}>
                {filled ? value : 'Unfilled'}
              </span>
            </div>
          );
        })}
      </div>

      {showNudge && completed < rows.length && (
        <div style={{ fontSize: '11px', color: brandTokens.colors.mutedText, lineHeight: 1.5 }}>
          Tip: filling the missing fields helps Balance respond faster and more accurately.
        </div>
      )}

      {readyForApproval && !approved && (
        <div style={{ display: 'grid', gap: '8px', marginTop: '4px' }}>
          <div style={{ fontSize: '11px', color: brandTokens.colors.mutedText, lineHeight: 1.5 }}>
            Review this brief carefully. When you approve it, Balance Assist will prepare it for the team.
          </div>
          <div style={{ display: 'grid', gap: '8px' }}>
            <button
              type="button"
              onClick={onApprove}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: 'none',
                background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
                color: brandTokens.colors.baseBlack,
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.12em'
              }}
            >
              Approve &amp; send to team
            </button>
            <button
              type="button"
              onClick={onContinueRefining}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: `1px solid ${brandTokens.colors.border}`,
                background: 'transparent',
                color: brandTokens.colors.lightText,
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.12em'
              }}
            >
              Continue refining
            </button>
          </div>
        </div>
      )}

      {approved && (
        <div style={{ fontSize: '11px', color: '#4ade80', lineHeight: 1.5 }}>
          Brief approved. You can now continue refining it or speak to the team.
        </div>
      )}
    </div>
  );
}
