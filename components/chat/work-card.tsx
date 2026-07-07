'use client';

import { brandTokens } from '@/lib/brand-tokens';

export type WorkCardCategory = 'reference' | 'mood' | 'pitch';

const CATEGORY_LABEL: Record<WorkCardCategory, string> = {
  reference: 'REFERENCE',
  mood: 'MOOD',
  pitch: 'PITCH'
};

export type WorkCardEntry = {
  title: string;
  slug: string;
  url: string;
  clients?: string;
  description?: string;
  image_url?: string;
  year?: number | null;
};

export function WorkCard({
  entry,
  category
}: {
  entry: WorkCardEntry;
  category: WorkCardCategory;
}) {
  const clientLine = [entry.clients, entry.year].filter(Boolean).join(' · ');
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="work-card"
      data-slug={entry.slug}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: '280px',
        minHeight: '220px',
        maxWidth: '300px',
        borderRadius: '12px',
        border: `1px solid ${brandTokens.colors.border}`,
        background: 'rgba(255, 255, 255, 0.03)',
        overflow: 'hidden',
        textDecoration: 'none',
        color: brandTokens.colors.lightText,
        flexShrink: 0,
        cursor: 'grab',
        userSelect: 'none',
        scrollSnapAlign: 'start',
        transition: 'border-color 0.15s ease, background 0.15s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = brandTokens.colors.warmGold;
        e.currentTarget.style.background = 'rgba(219, 181, 128, 0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = brandTokens.colors.border;
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
      }}
    >
      {entry.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.image_url}
          alt={entry.title}
          loading="lazy"
          data-testid="work-card-image"
          style={{
            width: '100%',
            height: '160px',
            objectFit: 'cover',
            display: 'block',
            background: 'rgba(0,0,0,0.4)'
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: '100%',
            height: '160px',
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: brandTokens.colors.mutedText,
            fontSize: '11px'
          }}
        >
          No preview
        </div>
      )}

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <span
            style={{
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: brandTokens.colors.warmGold
            }}
          >
            {CATEGORY_LABEL[category]}
          </span>
        </div>
        <p
          data-testid="work-card-title"
          style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: 600,
            lineHeight: 1.35,
            color: brandTokens.colors.lightText
          }}
        >
          {entry.title}
        </p>
        {clientLine && (
          <p
            style={{
              margin: 0,
              fontSize: '11px',
              color: brandTokens.colors.mutedText,
              lineHeight: 1.4
            }}
          >
            {clientLine}
          </p>
        )}
        {entry.description && (
          <p
            style={{
              margin: '2px 0 0',
              fontSize: '11px',
              color: brandTokens.colors.mutedText,
              lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}
          >
            {entry.description}
          </p>
        )}
        <p
          style={{
            margin: '6px 0 0',
            fontSize: '11px',
            fontWeight: 600,
            color: brandTokens.colors.warmGold
          }}
        >
          View project →
        </p>
      </div>
    </a>
  );
}

export function WorkCardRow({
  entries
}: {
  entries: Array<{ entry: WorkCardEntry; category: WorkCardCategory }>;
}) {
  if (entries.length === 0) return null;
  return (
    <div
      data-testid="work-card-row"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        gap: '14px',
        overflowX: 'auto',
        overflowY: 'hidden',
        padding: '12px 0',
        scrollbarWidth: 'thin',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      {entries.map(({ entry, category }) => (
        <WorkCard key={entry.slug} entry={entry} category={category} />
      ))}
      <div
        data-testid="work-card-row-fade"
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: '28px',
          height: '100%',
          background: 'linear-gradient(to right, transparent, rgba(16,16,16,0.85))',
          pointerEvents: 'none'
        }}
      />
    </div>
  );
}