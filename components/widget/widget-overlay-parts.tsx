import Image from 'next/image';
import React, { useRef, useState } from 'react';
import { brandTokens } from '@/lib/brand-tokens';
import {
  serviceOptions
} from '@/lib/onboarding/service-options';
import type { BudgetBandId, ServiceOptionId, TimelineBandId } from '@/lib/onboarding/types';
import { HUMAN_UPLOAD_GUIDANCE } from '@/lib/uploads/file-policy';
import { useDialogFocus } from '@/components/widget/use-dialog-focus';

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
          <p id="balance-assist-dialog-title" style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: brandTokens.colors.lightText, letterSpacing: '0.02em' }}>
            {isTeamConnected ? 'Balance Studio Team' : 'Balance Assist'}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: '10px',
              color: brandTokens.colors.warmGold,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {isTeamConnected ? 'Human relay' : 'AI brief assistant'}
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
        Files requested by team
      </div>
      <div style={{ marginBottom: '6px' }}>
        {note ?? 'The team asked for files for this project.'}
      </div>
      <div style={{ fontSize: '11px', color: brandTokens.colors.mutedText }}>
        File delivery through this chat is currently unavailable. Reply to coordinate a supported transfer method.
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
      File delivery through this chat is currently unavailable
    </div>
  );
}

export function UploadPolicyModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ active: true, dialogRef, onDismiss: onClose });
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-policy-title"
        tabIndex={-1}
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
            <div id="upload-policy-title" style={{ marginTop: '4px', fontSize: '14px', fontWeight: 600 }}>Upload guidelines</div>
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
  humanStatus: 'idle' | 'requested' | 'sending' | 'saved' | 'queued' | 'delivered' | 'unavailable' | 'replied';
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
            role="status"
            aria-live="polite"
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
                  : humanStatus === 'queued' || humanStatus === 'saved' || humanStatus === 'sending' || humanStatus === 'requested'
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
            {(humanStatus === 'queued' || humanStatus === 'saved' || humanStatus === 'sending' || humanStatus === 'requested') && (
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
              : humanStatus === 'requested'
                ? 'Team contact requested'
                : humanStatus === 'sending'
                  ? 'Sending message'
                : humanStatus === 'saved'
                  ? 'Message saved'
                : humanStatus === 'queued'
                  ? 'Queued for the Balance team'
                : humanStatus === 'delivered'
                  ? 'Message delivered'
                : humanStatus === 'unavailable'
                  ? 'Message delivery unavailable'
                  : 'Connected to team'}
          </div>
        </div>
      )}
    </div>
  );
}

export function HumanFallbacks({
  calendlyUrl,
  unavailable = false,
  deliveryUnavailable = false
}: {
  calendlyUrl: string | null;
  unavailable?: boolean;
  deliveryUnavailable?: boolean;
}) {
  const copy = deliveryUnavailable
    ? 'Message delivery is unavailable. Please email the team or book a call instead.'
    : unavailable
      ? 'The private relay could not start. You can still contact the team directly.'
      : 'Prefer another route? Contact the team directly.';

  return (
    <div role={unavailable || deliveryUnavailable ? 'status' : undefined} style={{ display: 'grid', gap: 8, padding: 12, fontSize: 12, lineHeight: 1.5 }}>
      <p style={{ margin: 0 }}>{copy}</p>
      <a href="mailto:hello@balancestudio.tv" style={{ color: brandTokens.colors.warmGold }}>Email the team</a>
      {calendlyUrl && <a href={calendlyUrl} style={{ color: brandTokens.colors.warmGold }}>Book a call</a>}
    </div>
  );
}

export function ProjectBriefCard({
  draft,
  showNudge,
  readyForApproval,
  approved,
  title,
  onApprove,
  onContinueRefining,
  onChange,
  compact = false
}: {
  draft: {
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
  showNudge?: boolean;
  readyForApproval?: boolean;
  approved?: boolean;
  title?: string;
  onApprove?: () => void;
  onContinueRefining?: () => void;
  onChange?: (key: string, value: string) => void;
  compact?: boolean;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const rows: ReadonlyArray<{
    label: string;
    key: string;
    raw: string;
    display: string;
  }> = [
    {
      label: 'Project scope',
      key: 'projectScope',
      raw: draft.scopePolished || draft.projectScope,
      display: (draft.scopePolished || draft.projectScope).trim()
    },
    {
      label: 'Project type',
      key: 'projectType',
      raw: draft.projectType ?? '',
      display: formatProjectType(draft.projectType)
    },
    {
      label: 'Service',
      key: 'service',
      raw: draft.service,
      display: serviceOptions.find((s) => s.id === draft.service)?.label ?? draft.service
    },
    {
      label: 'Timeline',
      key: 'timelineBand',
      raw: draft.timelineBand,
      display: draft.timelineBand
    },
    {
      label: 'Budget',
      key: 'budgetBand',
      raw: draft.budgetBand,
      display: draft.budgetBand
    },
    {
      label: 'Contact name',
      key: 'contactName',
      raw: draft.contactName,
      display: draft.contactName.trim()
    },
    {
      label: 'Company',
      key: 'contactCompany',
      raw: draft.contactCompany ?? '',
      display: (draft.contactCompany ?? '').trim()
    },
    {
      label: 'Email',
      key: 'contactEmail',
      raw: draft.contactEmail,
      display: draft.contactEmail.trim()
    }
  ];

  const completed = rows.filter((row) => row.raw.trim().length > 0).length;

  const labelFontSize = compact ? 9 : 10;
  const bodyFontSize = compact ? 11 : 12;
  const nudgeFontSize = compact ? 10 : 11;

  return (
    <div
      data-testid="project-brief-card"
      data-compact={compact ? 'true' : 'false'}
      style={{
        border: `1px solid ${brandTokens.colors.border}`,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '12px',
        padding: compact ? '10px 10px' : '12px 14px',
        display: 'grid',
        gap: compact ? '6px' : '8px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: labelFontSize, fontWeight: 600, color: brandTokens.colors.warmGold, textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            {title ?? 'Project Brief'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: compact ? '4px' : '6px' }}>
        {rows.map((row, rowIndex) => {
          const filled = row.raw.trim().length > 0;
          const editing = editingKey === row.key;
          const openEditor = () => {
            if (onChange) setEditingKey(row.key);
          };
          const rowClick = onChange
            ? (event: React.MouseEvent<HTMLDivElement>) => {
                if (event.defaultPrevented) return;
                openEditor();
              }
            : undefined;
          const isLastRow = rowIndex === rows.length - 1;
          const labelStyle: React.CSSProperties = {
            fontSize: labelFontSize,
            fontWeight: 400,
            color: brandTokens.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.12em'
          };
          const valueStyle: React.CSSProperties = {
            fontSize: bodyFontSize,
            fontWeight: 600,
            color: brandTokens.colors.lightText
          };
          const baseRowStyle = compact
            ? {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: '2px',
                fontSize: bodyFontSize,
                cursor: onChange ? 'pointer' : 'default',
                borderBottom: isLastRow ? 'none' : `1px solid ${brandTokens.colors.subtleBorder}`,
                paddingBottom: isLastRow ? 0 : 4
              }
            : {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: '6px',
                fontSize: bodyFontSize,
                cursor: onChange ? 'pointer' : 'default',
                borderBottom: isLastRow ? 'none' : `1px solid ${brandTokens.colors.subtleBorder}`,
                paddingBottom: isLastRow ? 0 : 6
              };

          if (compact) {
            return (
              <div
                key={row.label}
                data-testid="brief-row"
                data-row-key={row.key}
                data-filled={filled ? 'true' : 'false'}
                data-editing={editing ? 'true' : 'false'}
                onClick={rowClick}
                style={baseRowStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    data-testid={filled ? 'brief-row-status' : undefined}
                    aria-hidden="true"
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: filled ? '#4ade80' : brandTokens.colors.mutedText,
                      border: filled ? '1px solid #4ade80' : `1px dashed ${brandTokens.colors.subtleBorder}`,
                      background: filled ? 'rgba(74,222,128,0.10)' : 'transparent'
                    }}
                  >
                    {filled ? '✓' : '·'}
                  </span>
                  <span
                    style={{
                      ...labelStyle,
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {row.label}
                  </span>
                  {onChange && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditor();
                      }}
                      data-testid={`brief-row-edit-${row.key}`}
                      aria-label={`Edit ${row.label.toLowerCase()}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: brandTokens.colors.mutedText,
                        cursor: 'pointer',
                        padding: 2,
                        fontSize: 10,
                        lineHeight: 1
                      }}
                    >
                      ✎
                    </button>
                  )}
                </div>
                {filled && !editing && (
                  <div
                    data-testid="brief-row-value"
                    style={{
                      ...valueStyle,
                      marginLeft: 20,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {row.display}
                  </div>
                )}
                {editing && (
                  <BriefRowEditor
                    row={row}
                    compact={true}
                    onCommit={(value) => {
                      onChange?.(row.key, value);
                      setEditingKey(null);
                    }}
                    onCancel={() => setEditingKey(null)}
                  />
                )}
              </div>
            );
          }
          return (
            <div
              key={row.label}
              data-testid="brief-row"
              data-row-key={row.key}
              data-filled={filled ? 'true' : 'false'}
              data-editing={editing ? 'true' : 'false'}
              onClick={rowClick}
              style={baseRowStyle}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}
              >
                <span style={labelStyle}>{row.label}</span>
                <span
                  data-testid={filled ? 'brief-row-value' : undefined}
                  style={{
                    color: filled ? brandTokens.colors.lightText : brandTokens.colors.mutedText,
                    textAlign: 'right',
                    maxWidth: '60%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    justifyContent: 'flex-end'
                  }}
                >
                  {filled && (
                    <span aria-hidden="true" style={{ color: '#4ade80', fontSize: 11, flexShrink: 0 }}>
                      ✓
                    </span>
                  )}
                  <span
                    style={
                      filled
                        ? { ...valueStyle, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                        : {
                            flex: 1,
                            minWidth: 0,
                            fontStyle: 'italic',
                            color: brandTokens.colors.mutedText,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }
                    }
                  >
                    {filled ? row.display : 'Not yet captured'}
                  </span>
                  {onChange && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditor();
                      }}
                      data-testid={`brief-row-edit-${row.key}`}
                      aria-label={`Edit ${row.label.toLowerCase()}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: brandTokens.colors.mutedText,
                        cursor: 'pointer',
                        padding: 2,
                        fontSize: 10,
                        lineHeight: 1,
                        flexShrink: 0
                      }}
                    >
                      ✎
                    </button>
                  )}
                </span>
              </div>
              {editing && (
                <BriefRowEditor
                  row={row}
                  compact={false}
                  onCommit={(value) => {
                    onChange?.(row.key, value);
                    setEditingKey(null);
                  }}
                  onCancel={() => setEditingKey(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {showNudge && completed < rows.length && (
        <div style={{ fontSize: nudgeFontSize, color: brandTokens.colors.mutedText, lineHeight: 1.5 }}>
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
        <div role="status" aria-live="polite" style={{ fontSize: '11px', color: '#4ade80', lineHeight: 1.5 }}>
          Brief approved. You can now continue refining it or speak to the team.
        </div>
      )}
    </div>
  );
}

type BriefRow = {
  label: string;
  key: string;
  raw: string;
  display: string;
};

function formatProjectType(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  const withSpaces = trimmed.replace(/-/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function BriefRowEditor({
  row,
  compact = true,
  onCommit,
  onCancel
}: {
  row: BriefRow;
  compact?: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(row.raw);

  function commit() {
    onCommit(value);
  }

  const containerStyle: React.CSSProperties = compact
    ? { marginLeft: 20, display: 'flex', alignItems: 'center', gap: 6 }
    : { display: 'flex', alignItems: 'center', gap: 6, width: '100%' };

  return (
    <div style={containerStyle}>
      <input
        type="text"
        value={value}
        aria-label={row.label}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={commit}
        style={{
          flex: 1,
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${brandTokens.colors.border}`,
          color: brandTokens.colors.lightText,
          borderRadius: 6,
          padding: '4px 6px',
          fontSize: 12,
          outline: 'none',
          minWidth: 0
        }}
      />
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
        aria-label={`Cancel editing ${row.label.toLowerCase()}`}
        style={{
          background: 'transparent',
          border: 'none',
          color: brandTokens.colors.mutedText,
          cursor: 'pointer',
          fontSize: 11
        }}
      >
        ×
      </button>
    </div>
  );
}

// Re-export option-id types for downstream casts (kept here to avoid an extra import line elsewhere).
export type { ServiceOptionId, TimelineBandId, BudgetBandId };
