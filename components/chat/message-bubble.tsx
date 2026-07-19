'use client';

import { memo } from 'react';
import { brandTokens } from '@/lib/brand-tokens';
import type { ChatMessage, InlineCard } from '@/lib/conversation/types';
import { WorkCardRow, type WorkCardCategory } from '@/components/chat/work-card';

type MessageBubbleProps = {
  message: ChatMessage;
  onInlineCardClick?: (card: InlineCard) => void;
};

function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\\n|\n)/g);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} style={{ fontWeight: 600, color: brandTokens.colors.lightText }}>
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return (
        <em key={i} style={{ fontSize: '11px', color: brandTokens.colors.mutedText }}>
          {part.slice(1, -1)}
        </em>
      );
    }

    if (part === '\\n' || part === '\n') {
      return <br key={i} />;
    }

    return <span key={i}>{part}</span>;
  });
}

export const MessageBubble = memo(function MessageBubble({ message, onInlineCardClick }: MessageBubbleProps) {
  const isBot = message.sender === 'bot';

  if (message.isSystem) {
    return (
      <div role="group" aria-label="System message" style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        <div
          style={{
            padding: '6px 14px',
            borderRadius: '12px',
            background: 'rgba(74, 222, 128, 0.08)',
            border: '1px solid rgba(74, 222, 128, 0.3)',
            color: '#4ade80',
            fontSize: '11px',
            fontWeight: 600,
            textAlign: 'center',
            letterSpacing: '0.02em'
          }}
        >
          {renderText(message.text)}
        </div>
      </div>
    );
  }

  if (message.isTeamMessage) {
    return (
      <div role="group" aria-label="Message from Balance Studio Team" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <span
          style={{
            marginLeft: '4px',
            marginBottom: '4px',
            fontSize: '10px',
            fontWeight: 600,
            color: brandTokens.colors.warmGold,
            textTransform: 'uppercase',
            letterSpacing: '0.16em'
          }}
        >
          Balance Studio Team
        </span>
        <div
          style={{
            maxWidth: 'min(78%, 620px)',
            padding: '12px 16px',
            borderRadius: '4px 16px 16px 16px',
            background: 'rgba(74, 222, 128, 0.06)',
            border: '1px solid rgba(74, 222, 128, 0.3)',
            borderLeftWidth: '3px',
            fontSize: '13px',
            lineHeight: 1.6,
            color: brandTokens.colors.lightText
          }}
        >
          {renderText(message.text)}
        </div>
      </div>
    );
  }

  if (isBot) {
    const hasText = Boolean(message.text?.trim());
    const hasAttachment = Boolean(message.attachment);
    const hasInlineCards = Boolean(message.inlineCards?.length);
    const hasSharedWork = Boolean(message.sharedWork?.entries?.length);
    const showBubble = hasText || hasAttachment;

    return (
      <div role="group" aria-label="Message from Balance Assist" style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'flex-start' }}>
        {showBubble && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <BotAvatar />
            <div
              className={`balance-message-bubble${message.isDisclaimer ? ' balance-message-bubble--disclaimer' : ''}`}
              style={{
                maxWidth: 'min(78%, 620px)',
                padding: '12px 16px',
                borderRadius: '16px 16px 16px 4px',
                background: message.isDisclaimer ? 'rgba(219, 181, 128, 0.08)' : 'rgba(255, 255, 255, 0.06)',
                border: `1px solid ${message.isDisclaimer ? brandTokens.colors.border : brandTokens.colors.subtleBorder}`,
                fontSize: '13px',
                lineHeight: 1.6,
                color: brandTokens.colors.lightText
              }}
            >
              {renderText(message.text)}
            </div>
          </div>
        )}

        {!showBubble && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <BotAvatar />
          </div>
        )}

        {message.attachment && (
          <div
            style={{
              marginLeft: '36px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: `1px solid ${brandTokens.colors.border}`,
              background: 'rgba(219, 181, 128, 0.06)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              maxWidth: 'min(78%, 560px)'
            }}
          >
            <FileIcon />
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: brandTokens.colors.lightText }}>
                {message.attachment.name}
              </p>
              <p style={{ margin: 0, fontSize: '11px', color: brandTokens.colors.mutedText }}>
                {message.attachment.size}
              </p>
              {message.attachment.previewUrl && message.attachment.mediaKind === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={message.attachment.previewUrl}
                  alt={message.attachment.name}
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    maxWidth: '180px',
                    maxHeight: '120px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    display: 'block'
                  }}
                />
              )}
              {message.attachment.previewUrl && message.attachment.mediaKind === 'video' && (
                <video
                  src={message.attachment.previewUrl}
                  controls
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    maxWidth: '180px',
                    maxHeight: '120px',
                    borderRadius: '8px',
                    display: 'block'
                  }}
                />
              )}
            </div>
          </div>
        )}

        {message.inlineCards && (
          <div style={{ marginLeft: '36px', display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '680px', width: 'calc(100% - 36px)' }}>
            {message.inlineCards.map((card, i) => (
              <InlineCardView key={i} card={card} onClick={onInlineCardClick} />
            ))}
          </div>
        )}

        {message.sharedWork && message.sharedWork.entries.length > 0 && (
          <div style={{ marginLeft: '36px', width: '100%' }}>
            <WorkCardRow
              entries={message.sharedWork.entries.map((entry) => ({
                entry,
                category: (entry.category as WorkCardCategory) ?? 'reference'
              }))}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div role="group" aria-label="Message from you" style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        className="balance-message-bubble balance-message-bubble--user"
        style={{
          maxWidth: 'min(78%, 620px)',
          padding: '10px 14px',
          borderRadius: '16px 16px 4px 16px',
          background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
          color: brandTokens.colors.baseBlack,
          fontSize: '13px',
          lineHeight: 1.5,
          fontWeight: 500
        }}
      >
        {renderText(message.text)}
      </div>
    </div>
  );
});

function BotAvatar() {
  return (
    <div
      aria-hidden="true"
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
          stroke="#101010"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
        stroke={brandTokens.colors.warmGold}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke={brandTokens.colors.warmGold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InlineCardView({ card, onClick }: { card: InlineCard; onClick?: (card: InlineCard) => void }) {
  const icon =
    card.type === 'calendly' ? <CalendlyIcon /> : card.type === 'telegram' ? <TelegramIcon /> : <EmailIcon />;

  const handleClick = (e: React.MouseEvent) => {
    if (onClick && card.type !== 'email') {
      e.preventDefault();
      onClick(card);
    }
  };

  const href = card.type === 'email'
    ? card.href
    : card.type === 'calendly'
      ? card.url
      : '#';
  const target = card.type === 'email' || card.type === 'telegram' ? undefined : '_blank';

  return (
    <a
      className="balance-widget-interactive"
      href={href}
      target={target}
      rel="noopener noreferrer"
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px',
        borderRadius: '12px',
        border: `1px solid ${brandTokens.colors.border}`,
        background: 'rgba(219, 181, 128, 0.04)',
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = brandTokens.colors.warmGold;
        e.currentTarget.style.background = 'rgba(219, 181, 128, 0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = brandTokens.colors.border;
        e.currentTarget.style.background = 'rgba(219, 181, 128, 0.04)';
      }}
    >
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: 600,
            color: brandTokens.colors.lightText,
            fontFamily: brandTokens.typography.ui
          }}
        >
          {card.label}
        </p>
        {card.subtitle && (
          <p
            style={{
              margin: '2px 0 0',
              fontSize: '11px',
              color: brandTokens.colors.mutedText
            }}
          >
            {card.subtitle}
          </p>
        )}
      </div>
      <span style={{ color: brandTokens.colors.warmGold, fontSize: '16px', flexShrink: 0 }}>&#8594;</span>
    </a>
  );
}

function CalendlyIcon() {
  return (
    <div
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        background: 'rgba(219, 181, 128, 0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="18" rx="2" stroke={brandTokens.colors.warmGold} strokeWidth="2" />
        <path d="M16 2v4M8 2v4M3 10h18" stroke={brandTokens.colors.warmGold} strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function TelegramIcon() {
  return (
    <div
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        background: 'rgba(219, 181, 128, 0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M21.5 4.5L2.5 12l5 2 2 6 3-4 5 4 4-15.5z"
          stroke={brandTokens.colors.warmGold}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function EmailIcon() {
  return (
    <div
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        background: 'rgba(219, 181, 128, 0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke={brandTokens.colors.warmGold} strokeWidth="2" />
        <path d="M2 7l10 7 10-7" stroke={brandTokens.colors.warmGold} strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
