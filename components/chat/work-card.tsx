'use client';

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
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
        alignSelf: 'stretch',
        minWidth: '240px',
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
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
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
            height: '130px',
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
            height: '130px',
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

      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
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

type DragState = {
  startX: number;
  scrollLeft: number;
  totalMoved: number;
  isActive: boolean;
};

const DRAG_CLICK_THRESHOLD_PX = 5;

export function WorkCardRow({
  entries
}: {
  entries: Array<{ entry: WorkCardEntry; category: WorkCardCategory }>;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const hasScrolledRef = useRef<boolean>(false);
  const [isDragging, setIsDragging] = useState(false);
  const [scrollMetrics, setScrollMetrics] = useState<{ pageCount: number; activePage: number }>({
    pageCount: 1,
    activePage: 0
  });
  const [rowWidth, setRowWidth] = useState<number>(0);
  const [hasScrolled, setHasScrolled] = useState(false);

  function beginDrag(clientX: number) {
    if (!rowRef.current) return;
    dragStateRef.current = {
      startX: clientX,
      scrollLeft: rowRef.current.scrollLeft,
      totalMoved: 0,
      isActive: true
    };
    setIsDragging(true);
  }

  function endDrag() {
    if (dragStateRef.current) {
      dragStateRef.current.isActive = false;
    }
    setIsDragging(false);

    if (!rowRef.current) return;
    const row = rowRef.current;
    const clientWidth = row.clientWidth;
    if (clientWidth <= 0) return;
    const max = row.scrollWidth - clientWidth;
    if (max <= 0) return;
    const nearest = Math.max(0, Math.min(max, Math.round(row.scrollLeft / clientWidth) * clientWidth));
    if (Math.abs(nearest - row.scrollLeft) < 1) return;
    row.scrollTo({ left: nearest, behavior: 'smooth' });
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // Prevent the underlying <a> from being activated when the user starts a drag.
    event.preventDefault();
    beginDrag(event.clientX);
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    beginDrag(touch.clientX);
  }

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const state = dragStateRef.current;
      if (!state || !state.isActive || !rowRef.current) return;
      event.preventDefault();
      const delta = event.clientX - state.startX;
      state.totalMoved = Math.max(state.totalMoved, Math.abs(delta));
      rowRef.current.scrollLeft = state.scrollLeft - delta;
    }

    function handleTouchMove(event: TouchEvent) {
      const state = dragStateRef.current;
      if (!state || !state.isActive || !rowRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const delta = touch.clientX - state.startX;
      state.totalMoved = Math.max(state.totalMoved, Math.abs(delta));
      rowRef.current.scrollLeft = state.scrollLeft - delta;
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('mouseleave', endDrag);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', endDrag);
    document.addEventListener('touchcancel', endDrag);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', endDrag);
      document.removeEventListener('mouseleave', endDrag);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', endDrag);
      document.removeEventListener('touchcancel', endDrag);
    };
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    function recompute() {
      const el = rowRef.current;
      if (!el) return;
      const clientWidth = el.clientWidth;
      const scrollWidth = el.scrollWidth;
      if (clientWidth <= 0) {
        setScrollMetrics({ pageCount: 1, activePage: 0 });
        setRowWidth(0);
        return;
      }
      const pageCount = Math.max(1, Math.ceil(scrollWidth / clientWidth));
      const activePage = Math.min(
        pageCount - 1,
        Math.max(0, Math.round(el.scrollLeft / clientWidth))
      );
      setScrollMetrics({ pageCount, activePage });
      setRowWidth(clientWidth);
    }

    function onScroll() {
      const el = rowRef.current;
      if (!el) return;
      recompute();
      if (el.scrollLeft > 4 && !hasScrolledRef.current) {
        hasScrolledRef.current = true;
        setHasScrolled(true);
      }
    }

    recompute();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null;
    if (observer) observer.observe(row);
    row.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', recompute);
    return () => {
      if (observer) observer.disconnect();
      row.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', recompute);
    };
  }, [entries.length]);

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>) {
    const state = dragStateRef.current;
    if (state && state.totalMoved > DRAG_CLICK_THRESHOLD_PX) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleRowMouseLeave() {
    if (isDragging) {
      endDrag();
    }
  }

  if (entries.length === 0) return null;
  const isOverflowing = scrollMetrics.pageCount > 1 && rowWidth > 0;
  return (
    <div
      ref={rowRef}
      data-testid="work-card-row"
      data-dragging={isDragging ? 'true' : 'false'}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onClick={handleRowClick}
      onMouseLeave={handleRowMouseLeave}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: '14px',
        overflowX: 'auto',
        overflowY: 'hidden',
        padding: '12px 0',
        scrollbarWidth: 'thin',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: isDragging ? 'none' : 'auto',
        touchAction: 'pan-x',
        overscrollBehaviorX: 'contain',
        minHeight: '220px'
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
      {isOverflowing && !hasScrolled && (
        <div
          data-testid="work-card-row-swipe-hint"
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: '14px',
            bottom: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '999px',
            background: 'rgba(16, 16, 16, 0.55)',
            border: `1px solid ${brandTokens.colors.subtleBorder}`,
            pointerEvents: 'none',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: brandTokens.colors.mutedText,
            opacity: hasScrolled ? 0 : 0.85,
            transition: 'opacity 0.4s ease'
          }}
        >
          <span>Swipe</span>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
            <path
              d="M1 5h11M8 1l4 4-4 4"
              stroke={brandTokens.colors.warmGold}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
}