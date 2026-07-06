# Balance Assist AI-First Intake Design

## Goal

Make Balance Assist feel genuinely intelligent from the first user message by making Deepseek v4 Flash the primary intake engine, while keeping a persistent structured brief card, explicit client approval before team handoff, and stronger visual separation between AI mode and human mode.

## Approved Product Direction

### AI mode should be LLM-first

- The very first user message should go to Deepseek v4 Flash.
- The AI should not push users through a rigid scripted sequence unless a fallback is needed.
- The AI should gather information flexibly in whatever order the user naturally provides it.
- Structured fields should still be extracted in the background to populate the project brief card.

### Project Brief card should be persistent

- The brief card remains visible during AI mode.
- It shows:
  - project scope
  - service
  - timeline
  - budget
  - contact name
  - company
  - email
- Filled items show captured values.
- Missing items show as unfilled.
- The AI should nudge the user to complete missing items, but not force a linear form experience.

### Explicit client approval gate

- Once the brief is sufficiently complete, the UI presents an explicit review state.
- The user must choose **Approve & send to team** before the brief is officially handed off to Balance producers.
- The card should clearly communicate what will be sent.
- No silent background handoff.

### Human handoff can bypass approval

Approved behavior:

- `Talk to a human` may bypass the approval gate.
- If the user chooses that path, the system still shows the current brief card and sends the draft to the team as incomplete.
- The team should see the incomplete status in Telegram topic naming and topic status.

### Stronger mode distinction

- AI mode should clearly read as:
  - Balance Assist
  - AI assistant
  - guided brief capture
- Human mode should clearly read as:
  - Balance Studio Team
  - direct human support
  - message delivery / reply states

### Trust and thesis consistency

The flow must remain aligned with the thesis principles:

- explicit AI disclosure
- clear boundaries on pricing, contracts, and timelines
- warm but non-human tone
- context-aware follow-ups
- transparent memory and editable brief state
- obvious human escalation
- delivery and review states that are honest, not overstated

## Red-Team Findings

### 1. The current hybrid model is the main UX problem

The most trust-damaging issue is not malicious prompt injection, but the current hybrid orchestration: the system sometimes behaves like a form instead of a smart agent. This causes repetition, poor intent handling, and user frustration.

**Decision:** make the LLM the default engine for AI mode.

### 2. Structured extraction should stay server-side and validated

Even though the LLM drives the conversation, the output still needs schema enforcement.

**Decision:** keep the hidden structured draft channel and validate it server-side.

### 3. Approval is critical for trust and handoff quality

Without an explicit approval step, the user can feel that the AI is sending partial or wrong information behind their back.

**Decision:** add an explicit approval gate before formal AI-to-team handoff.

### 4. Human bypass must stay possible

If the user is frustrated or simply wants human help, requiring approval first adds friction and reduces trust.

**Decision:** human escalation may bypass approval, but the draft is marked incomplete.

## System Behavior

### AI mode

- User speaks naturally.
- Deepseek responds naturally.
- The brief card updates live from extracted fields.
- The AI asks only for the most useful missing information next.
- The AI can answer process questions, but never make binding commitments.

### Approval mode

- When enough substance exists, show:
  - brief review card
  - incomplete fields still visible
  - **Approve & send to team** CTA
  - optional **Continue refining** CTA

### Human mode

- If the user approves, handoff proceeds with a complete draft.
- If the user bypasses via `Talk to a human`, handoff proceeds immediately with current draft state.
- Telegram topic still created only on the first human-mode message.

## Telegram Team Experience

- Topic naming still uses:
  - `🆕 Name / Company (ShortID)`
  - `✅ Name / Company (ShortID)`
  - etc.
- In bypass mode, the topic/message copy should make it clear the brief is incomplete.
- The team should still be able to request files and scheduling from Telegram using slash commands.

## UX Notes

- The brief card should appear above the message list in AI mode.
- It should not dominate the view, but remain visible enough to orient the user.
- The AI should reference missing fields in a natural way:
  - “I still don’t have your timeline or budget range.”
  - “I’ve captured the project scope, but I still need the right contact details.”

## Non-Goals

- This design does not remove structured storage or server-side validation.
- This design does not make the AI answer in human mode.
- This design does not require all users to complete the card before human help.
