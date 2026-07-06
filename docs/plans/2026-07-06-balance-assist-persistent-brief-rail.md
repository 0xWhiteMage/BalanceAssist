# Balance Assist — Persistent Left-Rail Brief + Attachment Popover Fix

## Goal

Replace the slide-out brief panel (current `<BriefPanelTab>` + `<BriefReviewScreen>`) with a **persistent left rail** that is visible alongside the chat from the moment the user expresses project intent. Fix the attachment popover that currently slides under the panel when both are open. Keep all other behavior unchanged.

## Background

The current widget (`components/widget/widget-overlay.tsx`) renders the brief in **three** places:
1. A `ProjectBriefCard` inline inside the chat scroll (line 1063).
2. A `BriefPanelTab` edge tab on the right of the chat (line 1091–1098).
3. A `BriefReviewScreen` slide-out from the right (line 1101–1129).

These three surfaces are visually distinct and fight for the same screen real estate. The user reports they only see the brief when they scroll up (because #1 is inline in chat scroll), and that the attachment popover `clashes` with the open review panel (because the slide-out panel at `z-index: 30` covers the popover at `z-index: 25`).

The user pointed to the **reference image** showing the target layout:
- **Left rail always visible during intake** — panels 02–05 of the reference show the rail open from the moment the welcome panel closes. There is no slide-out, no edge tab, no click-to-open.
- **Two visual states in the rail**:
  - "Guided Onboarding — Essentials" (panel 03): progress strip, the user's captured fields rendered as field rows with leading icons, and quick-reply chips for the next field to capture.
  - "Summary & Next Steps" (panel 05): Project Summary at the top, At-a-Glance guidance on the right, with two CTAs at the bottom — "Book a call" and "Request human follow-up" — plus "Continue refining brief" to keep iterating. The Project Brief appears here ready-to-send.
- **File upload + review screen** (panel 04) is rendered IN the chat scroll area, with the bottom showing "TALK TO A HUMAN".
- **Mobile** (panel 06): full-width stack. The chat is at the top, the brief summary is at the bottom. Same left rail becomes a slide-up panel on mobile.

The previous, pre-tool-calling version of the widget had a single persistent `ProjectBriefCard` rendered beside the chat — the user wants that restored and improved, now also keeping the new "Approve & send to team" CTA from the `BriefReviewScreen`.

## Approved Product Direction

### Layout (matches reference image)

The widget becomes a two-column layout, **always** present during AI intake:

```
┌─────────────────────────────────────────────────────┐
│  Balance Assist   ● online                          │  ← header
├──────────────────────┬──────────────────────────────┤
│  LEFT RAIL           │  RIGHT: CHAT                 │
│  (always visible     │                               │
│   during intake)     │  [Welcome cards /]           │
│                      │  chat messages scroll        │
│  ── Progress ──      │                               │
│  3 of 8 captured     │                               │
│  ━━━━━━━░░░░░░░░     │                               │
│                      │                               │
│  ── Essentials ──    │                               │
│  Project scope   ✕   │                               │
│  Service         ✓   │                               │
│  Project type   ✓   │                               │
│  Timeline        ✕   │                               │
│  Budget          ✕   │                               │
│  Contact         ✕   │                               │
│  Email           ✕   │                               │
│  Company         ✕   │                               │
│                      │                               │
│  ── Reference ──     │                               │
│  (chips / files)     │                               │
│                      │                               │
│  When complete:      │                               │
│  [ Approve & Send ]  │                               │
│                      │                               │
│                      ├──────────────────────────────┤
│                      │  📎 Type your message...  ➤   │
│                      │  [Talk to a human]            │
└──────────────────────┴──────────────────────────────┘
```

### Visibility rules

- The left rail is **always visible** during AI intake (non-team-connected). It shows even for the welcome/open state, displaying a progress strip and the "What we need to capture" essentials.
- The left rail is **hidden** while the user is team-connected (`isTeamConnected === true`).
- This is a behavior change from the previous design which gated on `hasProjectIntent`. The reference image confirms the rail is always visible. The system can pre-populate the rail with everything still unfilled, then update in real time as the user types.

### Two visual states inside the rail

The rail has TWO internal states (controlled by a mode switch or auto-progress):

1. **ESSENTIALS** (when brief is **not yet reviewable**): show the progress strip and the list of fields with quick-reply chips for the next-field-to-capture (per the reference image panel 03). Updates as the user types.
2. **SUMMARY & NEXT STEPS** (when brief **is reviewable**): show Project Summary + At-a-Glance guidance + three CTAs ("Book a call", "Request human follow-up", "Continue refining brief").

State transition logic:
- Default state: ESSENTIALS.
- When `isBriefReadyForApproval(draft)` flips to true: **AUTO-SWITCH** to SUMMARY.
- "Continue refining brief" returns the rail to ESSENTIALS.
- "Send to Balance team" finalizes the brief.

### Mobile / narrow widths

At widget width < 560px, the layout collapses to a vertical stack: chat on top, rail at the bottom (full-width). A tab strip "Chat | Brief" switches between them. This matches the reference image panel 06.

### Attachment popover

- Anchored above the input bar.
- Always `z-index: 100`.
- Width bounded by the chat column (does not overflow into the rail).
- Click-attach or click-outside closes it.
- ESC keypress closes it.
- Upload progress and errors appear inline, never clipped.

### What goes away

- `<BriefPanelTab>` and its one-shot pulse animation. **Deleted.**
- `<BriefReviewScreen>`. **Deleted.**
- The `briefPanelOpen`, `briefPanelFirstReady`, and `briefPanelFirstReadyRef` state — gone.
- The gating `hasProjectIntent` on the brief (rail is now always visible).
- The previous inline `<ProjectBriefCard>` in chat scroll.

### What is preserved

- Chat route, system prompt, Deepseek tool-calling, `record_brief_updates` flow.
- `handleApproveBrief` and the finalize path.
- The `ProjectBriefCard` component is reused in ESSENTIALS mode.
- The attachment dropzone behavior (URL paste + file upload).
- Telegram-first uploads, schema migrations, public API surface.

## Architecture

### Files

- `components/widget/review-panel.tsx` — NEW. The persistent left rail. Combines `ProjectBriefCard` + the "Approve & send to team" CTA at the bottom. Renders nothing when `!hasProjectIntent`. Renders nothing when `isTeamConnected`.
- `components/widget/widget-overlay.tsx` — MODIFY. Replace the inline `<ProjectBriefCard>` mount, the `<BriefPanelTab>`, and the `<BriefReviewScreen>` slide-out with a two-column layout: `[ReviewPanel | Chat]`.
- `components/widget/brief-panel-tab.tsx` — DELETE.
- `tests/widget/brief-panel-tab.test.tsx` — DELETE.
- `tests/widget/review-panel.test.tsx` — NEW.
- `tests/widget/widget-overlay.test.tsx` (NEW if it doesn't exist; OR add to existing `tests/widget/widget-page.test.tsx`) — assert two-column layout, attach popover z-index.
- `tests/e2e/intake.spec.ts` — MODIFY. Assert persistent left rail visibility after intent, click Approve, verify the chat remains visible.
- `README.md` — MODIFY. Update the intake-flow paragraph and the screenshot description.

### Two-column layout technique

Inside the widget outer panel (line 967 in `widget-overlay.tsx`), the body container becomes:

```tsx
<div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
  {!isTeamConnected && (
    <div style={{
      width: viewportWide ? 280 : '100%',
      flexShrink: 0,
      borderRight: viewportWide ? '1px solid border' : 'none',
      overflowY: 'auto',
      display: viewportWide ? 'block' : (railMode === 'essentials' || railMode === 'summary' ? 'block' : 'none')
    }}>
      <ReviewPanel
        draft={draft}
        approved={briefApproved}
        mode={railMode}                    // 'essentials' | 'summary'
        onApprove={handleApproveBrief}
        onContinueRefining={() => setRailMode('essentials')}
      />
    </div>
  )}
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
                display: viewportWide ? 'flex' : (railMode === 'hidden' ? 'flex' : 'none') }}>
    {/* chat messages + input bar, exactly as today */}
  </div>
</div>
```

`railMode` defaults to `'essentials'`. When `isBriefReadyForApproval(draft)` flips to true, an effect sets `railMode = 'summary'`. Mobile fallback shows a "Chat | Brief" strip at top to toggle.

The widget outer panel grows wide enough to host both columns. We use `min(820px, calc(100vw - 48px))` for the rail + chat combo, and `min(380px, calc(100vw - 48px))` only when team-connected (rail hidden).

### Attachment popover fix

Today:

```tsx
{attachmentOpen && (
  <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(100% + 6px)', zIndex: 25, ... }}>
    <AttachmentDropzone ... />
  </div>
)}
```

It's already `position: absolute`, anchored to the input bar's `bottom: calc(100% + 6px)`. The clash was caused by the slide-out panel at `z-index: 30`. With the panel gone, the popover no longer has a higher-z sibling hiding it. We still harden it:

- Bump z-index to 100.
- Add an explicit boundary: the popover is rendered inside the chat column (`<div style={{ position: 'relative' }}>` around the input bar) so it can't escape the chat column's width.
- Click-outside closes (via document click listener, registered in the same useEffect as `attachmentOpen`).

### State changes

Drop from `widget-overlay.tsx`:

- `const [briefPanelOpen, setBriefPanelOpen] = useState(false);`
- `const [briefPanelFirstReady, setBriefPanelFirstReady] = useState(false);`
- `const briefPanelFirstReadyRef = useRef<boolean>(false);`
- The pulse-trigger effect that watches `briefReady`.
- The reset effects that zero out `briefPanelFirstReady` on `handleReset`.

Add (or use the existing) `attachmentOpen` cleanup:

- Document-level `click` listener while `attachmentOpen === true` to close on outside click.
- ESC keypress closes the popover.

### Component: `ReviewPanel`

`ReviewPanel` is the new left-rail component with TWO visual modes:

```tsx
'use client';
export function ReviewPanel({
  draft,
  approved,
  mode,                       // 'essentials' | 'summary'
  onApprove,
  onContinueRefining
}: {
  draft: LeadDraft;
  approved: boolean;
  mode: 'essentials' | 'summary';
  onApprove: () => void;
  onContinueRefining: () => void;
}) {
  const ready = isBriefReadyForApproval(draft);
  const missing = missingReviewFields(draft);
  const completed = 8 - missing.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px' }}>
      {/* Progress strip */}
      <ProgressStrip completed={completed} total={8} />

      {mode === 'essentials' && (
        <>
          <ProjectBriefCard draft={draft} showNudge title="Project Brief" />
          {/* Quick reply chips for the most-urgent missing field */}
          <NextFieldChips missing={missing} onSelect={...} />
        </>
      )}

      {mode === 'summary' && !approved && (
        <>
          <ProjectSummary draft={draft} />
          <AtAGlance draft={draft} />
          <div style={{ display: 'grid', gap: 8 }}>
            <PrimaryButton onClick={onApprove}>Approve &amp; send to team</PrimaryButton>
            <SecondaryButton onClick={() => openCalendly()}>Book a call</SecondaryButton>
            <SecondaryButton onClick={onContinueRefining}>Continue refining brief</SecondaryButton>
          </div>
        </>
      )}

      {approved && <ApprovedConfirmation />}
    </div>
  );
}
```

`isBriefReadyForApproval` and `missingReviewFields` come from `lib/conversation/review-state.ts` (already exists).

The new pieces are `ProgressStrip`, `NextFieldChips`, `ProjectSummary`, `AtAGlance`, plus the existing `ProjectBriefCard` and the buttons. Some of these can be inline in `ReviewPanel`; `ProgressStrip` and `NextFieldChips` are small enough to inline.

## Risk

- **Always-visible rail on initial open.** The welcome banner (panel 02 in the reference image) shows on top of the chat, but the rail is also visible. This is correct per the reference but means the first-time experience is denser than before. The rail starts with everything unfilled, visually communicating "we haven't captured anything yet".
- **Mode switching timing.** If the AI updates fields mid-conversation, `ready` can flip mid-render. We use `useEffect` to set `railMode` when `ready` becomes true, and `onContinueRefining` to set it back. Once approved, `railMode` is locked at "approved" via the `approved` flag.
- **Reference image panel 02 shows the welcome inside the chat column**, not as a separate screen. The widget already has a "VIEW CARDS" cluster on intro; we'll preserve that.

## Risk to avoid

- **Don't bury the chat.** The chat must remain the primary interaction surface. The rail is supporting evidence, not the conversation. If the reference image is read as "left rail is primary, chat is secondary", that contradicts the user's stated history ("back to the brief" implies the chat was always primary). We keep `flex: 1` on the chat column so it gets the larger share; the rail is fixed-width at 280px.

## Out of Scope

- Chat route, system prompt, model integration — unchanged.
- Telegram relay, finalize, schema — unchanged.
- Mobile-specific responsive work beyond the width gate above.
- Light/dark theme switching.
- Any further AI prompt work.

## Testing

- `tests/widget/review-panel.test.tsx` — renders essentials mode, renders summary mode when ready, renders confirmation when approved, mode switching via `onContinueRefining`.
- `tests/widget/widget-page.test.tsx` (or new `widget-overlay.test.tsx`) — verifies two-column DOM structure with the rail always visible during AI mode, no slide-out, no `BriefPanelTab` in the DOM.
- `tests/widget/attachment-dropzone.test.tsx` — existing, augmented with a z-index assertion.
- `tests/e2e/intake.spec.ts` — drives the full intake, verifies the left rail is always visible, clicks Approve, verifies the chat remains visible after approval and the summary mode shows.

## Commit Strategy

1. Add `components/widget/review-panel.tsx` + its test (one commit).
2. Rewrite `widget-overlay.tsx` to use the two-column layout with always-visible rail (one commit).
3. Delete `brief-panel-tab.tsx` + its test (one commit).
4. Strengthen the attachment popover (one commit).
5. Update `tests/e2e/intake.spec.ts` (one commit).
6. Update `README.md` (one commit).

Each commit ends with `npm test` and `npm run build` green.