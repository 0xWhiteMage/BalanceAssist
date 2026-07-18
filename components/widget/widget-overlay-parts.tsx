import Image from 'next/image';
import React, { useRef, useState } from 'react';
import { brandTokens } from '@/lib/brand-tokens';
import { normalizePublicReferenceUrl } from '@/lib/uploads/url-detect';
import {
  serviceOptions
} from '@/lib/onboarding/service-options';
import type { BudgetBandId, ServiceOptionId, TimelineBandId } from '@/lib/onboarding/types';
import { HUMAN_UPLOAD_GUIDANCE } from '@/lib/uploads/file-policy';
import { useDialogFocus } from '@/components/widget/use-dialog-focus';
import { CONFIDENTIAL_INTAKE_RESPONSE } from '@/lib/privacy/confidential-intent';

export const balanceLogoUrl =
  'https://images.squarespace-cdn.com/content/v1/5c81167bab1a62362b828e3f/d5e257d2-800b-4f0b-82e4-edfabe552823/gold.png?format=2500w';

export function WidgetOverlayHeader({
  isTeamConnected,
  humanRelayActive,
  isMaximized,
  canResize,
  onToggleMaximized,
  onClose
}: {
  isTeamConnected: boolean;
  humanRelayActive: boolean;
  isMaximized: boolean;
  canResize: boolean;
  onToggleMaximized: () => void;
  onClose: () => void;
}) {
  return (
    <header className="balance-widget-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div className="balance-widget-header-mark">
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
          <p id="balance-assist-dialog-title" className="balance-widget-title">
            {isTeamConnected ? 'Balance Studio Team' : humanRelayActive ? 'Balance Studio Relay' : 'Balance Assist'}
          </p>
          <p className="balance-widget-eyebrow">
            {isTeamConnected ? 'Team reply received' : humanRelayActive ? 'Human-only relay' : 'AI brief assistant'}
          </p>
        </div>
      </div>
      <div className="balance-widget-header-actions">
        {canResize && (
          <button type="button" onClick={onToggleMaximized} className="balance-widget-action balance-widget-header-icon" aria-label={isMaximized ? 'Minimize Balance Assist' : 'Maximize Balance Assist'}>
            {isMaximized ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4v5H4M15 20v-5h5M4 9l6-6M20 15l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </button>
        )}
        <button type="button" onClick={onClose} className="balance-widget-action balance-widget-header-icon" aria-label="Close Balance Assist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
    </header>
  );
}

export function BotAvatarSmall() {
  return (
    <div className="balance-widget-avatar">
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
        Use the upload control below to send the requested files for human review.
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
      Human file upload requested
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
  hasTeamReply = false,
  humanStatus,
  calendlyUrl = null,
  onConnect
}: {
  isTeamConnected: boolean;
  hasTeamReply?: boolean;
  humanStatus: 'idle' | 'requested' | 'sending' | 'saved' | 'queued' | 'delivered' | 'unavailable';
  calendlyUrl?: string | null;
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
        <div style={{ display: 'grid', gap: 6 }}>
          <button
            type="button"
            className="balance-widget-action"
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
              transition: 'transform 120ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms ease, background-color 150ms ease'
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
            Talk to the team without AI
          </button>
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px 16px', fontSize: 11 }}>
            <a href="mailto:hello@balancestudio.tv" style={{ color: brandTokens.colors.warmGold }}>Email the team</a>
            {calendlyUrl && <a href={calendlyUrl} style={{ color: brandTokens.colors.warmGold }}>Book a call</a>}
          </div>
        </div>
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
                humanStatus === 'queued' || humanStatus === 'saved' || humanStatus === 'sending' || humanStatus === 'requested'
                    ? brandTokens.colors.warmGold
                    : brandTokens.colors.mutedText
            }}
          >
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
            {humanStatus === 'requested'
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
          {hasTeamReply && (
            <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#4ade80', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
              Team response received
            </div>
          )}
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
      ? 'The human-only relay could not start. You can still contact the team directly.'
      : 'Prefer another route? Contact the team directly.';

  return (
    <div role={unavailable || deliveryUnavailable ? 'status' : undefined} style={{ display: 'grid', gap: 8, padding: 12, fontSize: 12, lineHeight: 1.5 }}>
      <p style={{ margin: 0 }}>{copy}</p>
      <a href="mailto:hello@balancestudio.tv" style={{ color: brandTokens.colors.warmGold }}>Email the team</a>
      {calendlyUrl && <a href={calendlyUrl} style={{ color: brandTokens.colors.warmGold }}>Book a call</a>}
    </div>
  );
}

export function ConfidentialDiversionRecovery({
  calendlyUrl,
  onHuman,
  onLeave
}: {
  calendlyUrl: string | null;
  onHuman: () => void;
  onLeave: () => void;
}) {
  return (
    <div data-testid="confidential-diversion-recovery" style={{ display: 'grid', gap: 10, padding: 12, fontSize: 12, lineHeight: 1.5 }}>
      <p role="status" style={{ margin: 0 }}>{CONFIDENTIAL_INTAKE_RESPONSE}</p>
      <p style={{ margin: 0 }}>Nothing is sent to the Balance team until you choose to continue.</p>
      <button type="button" onClick={onHuman} style={{ padding: '10px 12px', borderRadius: 999, border: 'none', background: brandTokens.colors.warmGold, color: brandTokens.colors.baseBlack, fontWeight: 700, cursor: 'pointer' }}>Talk to the team without AI</button>
      <a href="mailto:hello@balancestudio.tv" style={{ color: brandTokens.colors.warmGold }}>Email the team</a>
      {calendlyUrl && <a href={calendlyUrl} style={{ color: brandTokens.colors.warmGold }}>Book a call</a>}
      <button type="button" onClick={onLeave} style={{ padding: '8px 12px', borderRadius: 999, border: `1px solid ${brandTokens.colors.border}`, background: 'transparent', color: brandTokens.colors.lightText, cursor: 'pointer' }}>Leave</button>
    </div>
  );
}

export function ProjectBriefCard({
  draft,
  showNudge,
  title,
  onChange,
  provenance = {},
  referenceLinks = [],
  onAddReference,
  onRemoveReference,
  compact = false
}: {
  draft: {
    projectScope: string;
    projectObjective: string;
    audience: string;
    intendedOutputs: string;
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
  title?: string;
  onChange?: (key: string, value: string) => Promise<BriefMutationOutcome>;
  provenance?: Record<string, 'user-stated' | 'inferred' | 'confirmed' | 'cleared'>;
  referenceLinks?: ReadonlyArray<{ id: string; kind: string; url: string }>;
  onAddReference?: (url: string) => Promise<BriefMutationOutcome>;
  onRemoveReference?: (id: string) => Promise<BriefMutationOutcome>;
  compact?: boolean;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeEditor = () => {
    setEditingKey(null);
    requestAnimationFrame(() => editTriggerRef.current?.focus());
  };

  const projectSummary = draft.scopePolished?.trim() ?? '';
  const rows: ReadonlyArray<{
    label: string;
    key: string;
    raw: string;
    display: string;
    multiline?: boolean;
  }> = [
    ...(projectSummary && projectSummary !== draft.projectScope.trim()
      ? [{
          label: provenance.scopePolished === 'inferred'
            ? 'AI-drafted summary'
            : provenance.scopePolished === 'confirmed'
              ? 'Edited draft'
              : 'Project summary',
          key: 'scopePolished',
          raw: draft.scopePolished ?? '',
          display: projectSummary,
          multiline: true
        }]
      : []),
    {
      label: provenance.projectScope === 'user-stated'
        ? 'Original wording'
        : provenance.projectScope === 'confirmed'
          ? 'User-edited wording'
          : 'Project description',
      key: 'projectScope',
      raw: draft.projectScope,
      display: draft.projectScope.trim(),
      multiline: true
    },
    {
      label: 'Project objective',
      key: 'projectObjective',
      raw: draft.projectObjective,
      display: draft.projectObjective.trim(),
      multiline: true
    },
    {
      label: 'Audience',
      key: 'audience',
      raw: draft.audience,
      display: draft.audience.trim(),
      multiline: true
    },
    {
      label: 'Intended outputs',
      key: 'intendedOutputs',
      raw: draft.intendedOutputs,
      display: draft.intendedOutputs.trim(),
      multiline: true
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
  const coreKeys = new Set(['projectScope', 'scopePolished', 'projectObjective', 'service', 'contactName', 'contactEmail']);
  const rowGroups = [
    { label: 'Core details', rows: rows.filter((row) => coreKeys.has(row.key)) },
    { label: 'Optional details', rows: rows.filter((row) => !coreKeys.has(row.key)), includesReferences: true }
  ];

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

      {rowGroups.map((group) => (
      <div key={group.label} role="group" aria-label={group.label} style={{ display: 'grid', gap: compact ? '4px' : '6px' }}>
        <div style={{ fontSize: labelFontSize, fontWeight: 700, color: brandTokens.colors.warmGold }}>{group.label}</div>
        {group.rows.map((row, rowIndex) => {
          const filled = row.raw.trim().length > 0;
          const editing = editingKey === row.key;
          const openEditor = () => {
            if (onChange) setEditingKey(row.key);
          };
          const isLastRow = rowIndex === group.rows.length - 1;
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
                cursor: 'default',
                borderBottom: isLastRow ? 'none' : `1px solid ${brandTokens.colors.subtleBorder}`,
                paddingBottom: isLastRow ? 0 : 4
              }
            : {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: '6px',
                fontSize: bodyFontSize,
                cursor: 'default',
                borderBottom: isLastRow ? 'none' : `1px solid ${brandTokens.colors.subtleBorder}`,
                paddingBottom: isLastRow ? 0 : 6
              };

          if (compact) {
            return (
              <div
                key={row.key}
                data-testid="brief-row"
                data-row-key={row.key}
                data-filled={filled ? 'true' : 'false'}
                data-editing={editing ? 'true' : 'false'}
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
                    id={`brief-row-label-${row.key}`}
                    style={{
                      ...labelStyle,
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: row.multiline ? 'pre-wrap' : 'nowrap',
                      overflowWrap: row.multiline ? 'anywhere' : undefined,
                      overflow: row.multiline ? 'visible' : 'hidden',
                      textOverflow: row.multiline ? 'clip' : 'ellipsis'
                    }}
                  >
                    {row.label}
                  </span>
                  {onChange && (
                    <button
                      type="button"
                      className="balance-widget-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        editTriggerRef.current = event.currentTarget;
                        openEditor();
                      }}
                      data-testid={`brief-row-edit-${row.key}`}
                      aria-label={`Edit ${row.label.toLowerCase()}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: brandTokens.colors.mutedText,
                        cursor: 'pointer',
                        minWidth: 44,
                        minHeight: 44,
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
                      whiteSpace: row.multiline ? 'pre-wrap' : 'nowrap',
                      overflowWrap: row.multiline ? 'anywhere' : undefined,
                      overflow: row.multiline ? 'visible' : 'hidden',
                      textOverflow: row.multiline ? 'clip' : 'ellipsis'
                    }}
                  >
                    {row.display}
                  </div>
                )}
                {editing && (
                  <BriefRowEditor
                    row={row}
                    labelId={`brief-row-label-${row.key}`}
                    compact={true}
                    onCommit={(value) => onChange?.(row.key, value) ?? Promise.resolve({ status: 'failed', message: 'This edit cannot be saved.' })}
                    onSaved={closeEditor}
                    onCancel={closeEditor}
                  />
                )}
              </div>
            );
          }
          return (
            <div
              key={row.key}
              data-testid="brief-row"
              data-row-key={row.key}
              data-filled={filled ? 'true' : 'false'}
              data-editing={editing ? 'true' : 'false'}
              style={baseRowStyle}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}
              >
                <span id={`brief-row-label-${row.key}`} style={labelStyle}>{row.label}</span>
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
                        ? {
                            ...valueStyle,
                            flex: 1,
                            minWidth: 0,
                            whiteSpace: row.multiline ? 'pre-wrap' : 'nowrap',
                            overflowWrap: row.multiline ? 'anywhere' : undefined,
                            overflow: row.multiline ? 'visible' : 'hidden',
                            textOverflow: row.multiline ? 'clip' : 'ellipsis'
                          }
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
                      className="balance-widget-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        editTriggerRef.current = event.currentTarget;
                        openEditor();
                      }}
                      data-testid={`brief-row-edit-${row.key}`}
                      aria-label={`Edit ${row.label.toLowerCase()}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: brandTokens.colors.mutedText,
                        cursor: 'pointer',
                        minWidth: 44,
                        minHeight: 44,
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
                  labelId={`brief-row-label-${row.key}`}
                  compact={false}
                  onCommit={(value) => onChange?.(row.key, value) ?? Promise.resolve({ status: 'failed', message: 'This edit cannot be saved.' })}
                  onSaved={closeEditor}
                  onCancel={closeEditor}
                />
              )}
            </div>
          );
        })}
        {group.includesReferences && (
          <ReferenceLinkManager
            links={referenceLinks}
            onAdd={onAddReference}
            onRemove={onRemoveReference}
            labelFontSize={labelFontSize}
            bodyFontSize={bodyFontSize}
          />
        )}
      </div>
      ))}

      {showNudge && completed < rows.length && (
        <div style={{ fontSize: nudgeFontSize, color: brandTokens.colors.mutedText, lineHeight: 1.5 }}>
          Tip: filling the missing fields helps Balance respond faster and more accurately.
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
  multiline?: boolean;
};

export type BriefMutationOutcome =
  | { status: 'saved' }
  | { status: 'conflict'; message: string }
  | { status: 'failed'; message: string };

function formatProjectType(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  const withSpaces = trimmed.replace(/-/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function BriefRowEditor({
  row,
  labelId,
  compact = true,
  onCommit,
  onSaved,
  onCancel
}: {
  row: BriefRow;
  labelId: string;
  compact?: boolean;
  onCommit: (value: string) => Promise<BriefMutationOutcome>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(row.raw);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const outcome = await onCommit(value);
    setSaving(false);
    if (!outcome || outcome.status === 'saved') {
      onSaved();
      return;
    }
    setError(outcome.message);
  }

  const containerStyle: React.CSSProperties = compact
    ? { marginLeft: 20, display: 'grid', gap: 6 }
    : { display: 'grid', gap: 6, width: '100%' };

  const editorStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${brandTokens.colors.border}`,
    color: brandTokens.colors.lightText,
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 12,
    outline: 'none',
    minWidth: 0,
    resize: row.multiline ? 'vertical' : undefined
  };

  return (
    <div style={containerStyle}>
      {row.multiline ? (
        <textarea
          className="balance-widget-wrap"
          rows={3}
          value={value}
          aria-labelledby={labelId}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          style={editorStyle}
        />
      ) : (
        <input
          className="balance-widget-wrap"
          type="text"
          value={value}
          aria-labelledby={labelId}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          style={editorStyle}
        />
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className="balance-widget-action"
          aria-label={`Save ${row.label.toLowerCase()}`}
          disabled={saving}
          onClick={(event) => {
            event.stopPropagation();
            void save();
          }}
          style={{ minWidth: 44, minHeight: 44, borderRadius: 6, border: 'none', background: brandTokens.colors.warmGold, color: brandTokens.colors.baseBlack, cursor: 'pointer', fontWeight: 700 }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          className="balance-widget-action"
          disabled={saving}
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
          aria-label={`Cancel editing ${row.label.toLowerCase()}`}
          style={{ minWidth: 44, minHeight: 44, borderRadius: 6, border: `1px solid ${brandTokens.colors.border}`, background: 'transparent', color: brandTokens.colors.lightText, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div role="alert" style={{ display: 'grid', gap: 6, color: '#fca5a5', fontSize: 11 }}>
          <span>{error}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              aria-label={`Retry saving ${row.label.toLowerCase()}`}
              onClick={() => void save()}
              style={{ minWidth: 44, minHeight: 44 }}
            >
              Retry
            </button>
            <button
              type="button"
              aria-label={`Cancel editing ${row.label.toLowerCase()} after error`}
              onClick={onCancel}
              style={{ minWidth: 44, minHeight: 44 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReferenceLinkManager({
  links,
  onAdd,
  onRemove,
  labelFontSize,
  bodyFontSize
}: {
  links: ReadonlyArray<{ id: string; kind: string; url: string }>;
  onAdd?: (url: string) => Promise<BriefMutationOutcome>;
  onRemove?: (id: string) => Promise<BriefMutationOutcome>;
  labelFontSize: number;
  bodyFontSize: number;
}) {
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!onAdd || pending || !url.trim()) return;
    setPending('add');
    setError(null);
    const outcome = await onAdd(url.trim());
    setPending(null);
    if (outcome.status === 'saved') setUrl('');
    else setError(outcome.message);
  }

  async function remove(id: string) {
    if (!onRemove || pending) return;
    setPending(id);
    setError(null);
    const outcome = await onRemove(id);
    setPending(null);
    if (outcome.status !== 'saved') setError(outcome.message);
  }

  return (
    <div className="balance-widget-reference-manager">
      <label htmlFor="brief-reference-url" style={{ fontSize: labelFontSize, color: brandTokens.colors.mutedText }}>Reference links</label>
      <div className="balance-widget-reference-form">
        <input
          id="brief-reference-url"
          type="url"
          aria-label="Reference URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={pending === 'add'}
          className="balance-widget-reference-input"
        />
        <button type="button" onClick={() => void add()} disabled={!onAdd || Boolean(pending) || !url.trim()} className="balance-widget-reference-button">
          Add link
        </button>
      </div>
      {links.length > 0 ? links.map((link) => {
        const supported = normalizePublicReferenceUrl(link.url) !== null;
        return (
        <div key={link.id} className="balance-widget-reference-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            {supported ? (
              <a href={link.url} target="_blank" rel="noreferrer" style={{ color: brandTokens.colors.warmGold, overflowWrap: 'anywhere' }}>{link.url}</a>
            ) : (
              <span style={{ color: brandTokens.colors.mutedText, overflowWrap: 'anywhere' }}>{link.url}</span>
            )}
            {!supported && <div style={{ color: '#fca5a5', fontSize: 11 }}>Unsupported legacy link - not transferable</div>}
          </div>
          <button
            type="button"
            aria-label={`Remove ${link.url}`}
            onClick={() => void remove(link.id)}
            disabled={!onRemove || Boolean(pending)}
            className="balance-widget-reference-remove"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Remove
          </button>
        </div>
        );
      }) : <span style={{ color: brandTokens.colors.mutedText, fontSize: bodyFontSize, fontStyle: 'italic' }}>No reference links added</span>}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 11 }}>{error}</div>}
    </div>
  );
}

// Re-export option-id types for downstream casts (kept here to avoid an extra import line elsewhere).
export type { ServiceOptionId, TimelineBandId, BudgetBandId };
