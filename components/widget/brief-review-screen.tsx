'use client';
import { brandTokens } from '@/lib/brand-tokens';

export type ReferenceLink = { kind: 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive' | 'other'; url: string };
export type ReferenceFile = { name: string; sizeBytes: number; mime: string; telegramFileId: string };

export type BriefDraft = {
  projectScope: string;
  scopePolished?: string;
  projectType?: string;
  service: string;
  timelineBand: string;
  budgetBand: string;
  contactName: string;
  contactCompany?: string;
  contactEmail: string;
};

export function BriefReviewScreen({
  draft,
  referenceLinks,
  referenceFiles,
  onSend,
  onRefine
}: {
  draft: BriefDraft;
  referenceLinks: ReferenceLink[];
  referenceFiles: ReferenceFile[];
  onSend: () => void;
  onRefine: () => void;
}) {
  const rows: Array<[string, string]> = [
    ['Project scope', draft.scopePolished ?? draft.projectScope],
    ['Project type', draft.projectType ?? ''],
    ['Service', draft.service],
    ['Timeline', draft.timelineBand],
    ['Budget', draft.budgetBand],
    ['Contact name', draft.contactName],
    ['Company', draft.contactCompany ?? ''],
    ['Email', draft.contactEmail]
  ];

  const hasAttachments = referenceLinks.length > 0 || referenceFiles.length > 0;

  return (
    <div
      style={{
        display: 'grid',
        gap: 14,
        padding: '4px 0',
        color: brandTokens.colors.lightText
      }}
    >
      <div>
        <div
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: brandTokens.colors.warmGold,
            textTransform: 'uppercase',
            letterSpacing: '0.16em'
          }}
        >
          Project Brief
        </div>
        <div style={{ marginTop: '2px', fontSize: '14px', fontWeight: 600 }}>Review your brief</div>
      </div>

      <div
        style={{
          border: `1px solid ${brandTokens.colors.border}`,
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '12px',
          padding: '12px 14px',
          display: 'grid',
          gap: '6px'
        }}
      >
        {rows.map(([label, value]) => {
          const filled = value.trim().length > 0;
          const isEmail = label === 'Email' && filled;
          return (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'flex-start',
                fontSize: '12px'
              }}
            >
              <span style={{ color: brandTokens.colors.mutedText }}>{label}</span>
              <span
                style={{
                  color: filled ? brandTokens.colors.lightText : brandTokens.colors.mutedText,
                  textAlign: 'right',
                  maxWidth: '60%'
                }}
              >
                {!filled ? (
                  'Unfilled'
                ) : isEmail ? (
                  <a
                    href={`mailto:${value}`}
                    style={{ color: brandTokens.colors.warmGold, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                  >
                    contact
                  </a>
                ) : (
                  value
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          border: `1px solid ${brandTokens.colors.border}`,
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '12px',
          padding: '12px 14px',
          display: 'grid',
          gap: '10px'
        }}
      >
        <div
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: brandTokens.colors.warmGold,
            textTransform: 'uppercase',
            letterSpacing: '0.16em'
          }}
        >
          Attachments
        </div>
        {hasAttachments ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {referenceLinks.map((link) => (
              <span
                key={link.url}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: 999,
                  background: 'rgba(219, 181, 128, 0.10)',
                  border: `1px solid ${brandTokens.colors.subtleBorder}`,
                  color: brandTokens.colors.lightText
                }}
              >
                {link.kind} · {link.url}
              </span>
            ))}
            {referenceFiles.map((file) => (
              <span
                key={file.telegramFileId || file.name}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: 999,
                  background: 'rgba(219, 181, 128, 0.10)',
                  border: `1px solid ${brandTokens.colors.subtleBorder}`,
                  color: brandTokens.colors.lightText
                }}
              >
                {file.name}
              </span>
            ))}
          </div>
        ) : (
          <div
            style={{
              fontSize: '12px',
              color: brandTokens.colors.mutedText,
              lineHeight: 1.6
            }}
          >
            Drop your deck below, or add a reference link. Paste a link to a video, Figma, or drive file to share it with the team.
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <button
          type="button"
          onClick={onSend}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
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
          Send to Balance team
        </button>
        <button
          type="button"
          onClick={onRefine}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
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
  );
}
