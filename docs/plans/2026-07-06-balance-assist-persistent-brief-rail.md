# Balance Assist — Persistent Left-Rail Brief + Attachment Popover Fix

## Goal

Replace the slide-out brief panel (current `<BriefPanelTab>` + `<BriefReviewScreen>`) with a **persistent left rail** that is visible alongside the chat from the moment the user expresses project intent. Fix the attachment popover that currently slides under the panel when both are open. Keep all other behavior unchanged.

## Background

The current widget (`components/widget/widget-overlay.tsx`) renders the brief in **three** places:
1. A `ProjectBriefCard` inline inside the chat scroll (line 1063).
2. A `BriefPanelTab` edge tab on the right of the chat (line 1091–1098).
3. A `BriefReviewScreen` slide-out from the right (line 1101–1129).

These three surfaces are visually distinct and fight for the same screen real estate. The user reports they only see the brief when they scroll up (because #1 is inline in chat scroll), and that the attachment popover `clashes` with the open review panel (because the slide-out panel at `z-index: 30` covers the popover at `z-index: 25`).

The previous, pre-tool-calling version of the widget had a single persistent `ProjectBriefCard` rendered beside the chat at all times — the user wants that restored, while keeping the new "Approve & send to team" CTA from the `BriefReviewScreen`.

## Approved Product Direction

### Two-column layout

The widget becomes a two-column layout:

```
┌────────────────────────────────────────────────────┐
│  Balance Assist   ● online                  [x]    │
├────────────────────┬───────────────────────────────┤
│  REVIEW PANEL      │                               │
│  (240-280px wide)  │   Chat scroll area            │
│                    │                               │
│  ── Brief ──       │   [user] 30s animation       │
│  field1    ✕       │   [bot]  ...                  │
│  field2    ✕       │   ...                         │
│  ...               │                               │
│  ── Reference ──   │                               │
│  links             │                               │
│  files             │                               │
│                    │                               │
│  [Approve & send]  │                               │
│  (when reviewable) │                               │
│                    ├───────────────────────────────┤
│                    │  📎 Type your message...  ➤   │
│                    │  ↑ attach popover anchors ↑    │
│                    │                               │
│                    │  [Talk to a human]            │
└────────────────────┴───────────────────────────────┘
```

### Visibility rules

- The review panel is **hidden** when the user has not yet expressed project intent (first message is small-talk, etc.). When the AI extracts project intent (`hasProjectIntent` becomes true via the existing detection), the panel appears.
- The review panel is **hidden** while the user is team-connected (`isTeamConnected === true`). When the user clicks "Talk to a human", the brief is no longer relevant — the conversation runs through Telegram.
- The review panel is **always visible** otherwise, including for the user's entire intake until they finalize.

### Attachment popover

- Anchored above the input bar.
- Always `z-index: 100`.
- Width bounded by the chat column (does not overflow into the review panel column).
- Click-attach or click-outside closes it.
- Upload progress and errors appear inline, never clipped.

### What goes away

- `<BriefPanelTab>` and its one-shot pulse animation. **Deleted.**
- `<BriefReviewScreen>` is replaced by a new `<ReviewPanel>` that hosts both the brief content and the "Approve" CTA.
- The `briefPanelOpen` / `briefPanelFirstReady` state and the corresponding effects.

### What is preserved

- Chat route, system prompt, Deepseek tool-calling, `record_brief_updates` flow.
- `handleApproveBrief` exactly as-is.
- The `ProjectBriefCard` component is repurposed: we still use it as the visual brief inside the new `ReviewPanel`.
- The attachment dropzone behavior (URL paste + file upload).
- The Telegram-first uploads, the schema migrations, and the existing public API surface.

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
  {!isTeamConnected && hasProjectIntent && (
    <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid border', overflowY: 'auto' }}>
      <ReviewPanel draft={draft} onApprove={handleApproveBrief} />
    </div>
  )}
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    {/* chat messages + input bar, exactly as today */}
  </div>
</div>
```

The widget outer panel grows wide enough to host both columns. We'll keep `min(760px, calc(100vw - 48px))` for the brief + chat combo, `min(380px, calc(100vw - 48px))` only for the brief-less state (no intent yet, or team-connected).

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

```tsx
'use client';
export function ReviewPanel({
  draft,
  approved,
  onApprove
}: {
  draft: LeadDraft;
  approved: boolean;
  onApprove: () => void;
}) {
  const ready = isBriefReadyForApproval(draft);
  const missing = missingReviewFields(draft);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px' }}>
      <ProjectBriefCard draft={draft} showNudge title="Project Brief" />
      {ready && !approved && (
        <button onClick={onApprove}>Approve & send to team</button>
      )}
      {approved && <ApprovedConfirmation />}
    </div>
  );
}
```

`isBriefReadyForApproval` and `missingReviewFields` come from `lib/conversation/review-state.ts` (already exists).

## Risk

- **Mobile.** On narrow widths, the chat column gets squeezed. Mitigation: gate the panel on `width >= 560px` and fall back to single-column below that. (Default widget width is 760px on production layouts.)
- **State carryover.** If a user starts intake, then refreshes, the `hasProjectIntent` state is reset. The brief disappears until the user sends another intent-bearing message. That's the existing behavior; not new.
- **Approved state.** Once `briefApproved === true`, the panel still shows the "approved" confirmation in place of the approve CTA. The user said they like the approve flow, so this stays.

## Out of Scope

- Chat route, system prompt, model integration — unchanged.
- Telegram relay, finalize, schema — unchanged.
- Mobile-specific responsive work beyond the width gate above.
- Light/dark theme switching.
- Any further AI prompt work.

## Testing

- `tests/widget/review-panel.test.tsx` — renders all fields, renders approve CTA when ready, renders confirmation when approved.
- `tests/widget/widget-page.test.tsx` (or new `widget-overlay.test.tsx`) — verifies two-column DOM structure when intent is present, single-column when not, no `BriefPanelTab` in the DOM.
- `tests/widget/attachment-dropzone.test.tsx` — existing, augmented with a z-index assertion via `getComputedStyle` or `style` attribute.
- `tests/e2e/intake.spec.ts` — drives the full intake, verifies the left rail is persistent, clicks Approve, verifies the chat remains visible after approval.

## Commit Strategy

1. Add `components/widget/review-panel.tsx` + its test (one commit).
2. Rewrite `widget-overlay.tsx` to use the two-column layout, drop the slide-out (one commit).
3. Delete `brief-panel-tab.tsx` + its test (one commit).
4. Strengthen the attachment popover (one commit).
5. Update `tests/e2e/intake.spec.ts` (one commit).
6. Update `README.md` (one commit).

Each commit ends with `npm test` and `npm run build` green.