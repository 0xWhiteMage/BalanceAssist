# Balance Assist Trust And Handoff Design

## Goal

Refine Balance Assist so it behaves like a trustworthy AI intake agent before handoff, then becomes a true human-support relay after handoff, with one Telegram topic per real session and clearer trust/UX behaviors aligned to the thesis requirements.

## Red-Teamed Requirements

### AI role and boundaries

- Balance Assist must always introduce itself as an AI assistant for Balance.
- It must clearly state that it helps capture project briefs and route to the Balance team.
- It must never imply it is a person, never claim emotional or embodied actions, and never make binding commercial, legal, contractual, creative, or timeline commitments.
- Final pricing, timelines, contracts, and approvals always belong to human producers.

### Tone

- Tone should be warm, concise, calm, and creatively engaged.
- Response patterns should acknowledge uncertainty, short timelines, and incomplete information without sounding robotic.
- The agent should not use phrases like “I’ll personally handle this”.

### Intake flow

- Intake stays conversational, not a rigid form.
- Balance Assist should gather:
  - project overview
  - objectives and audience
  - constraints (timeline, budget)
  - assets and references
  - contact details
- After each section, the agent should summarize what it understood and ask for confirmation or correction.
- Sensitive questions must include a one-line explanation of why they matter.
- “Not sure yet” should always be valid and non-blocking.

### Memory transparency

- The agent should support explicit memory commands:
  - `What do you remember about my project?`
  - targeted correction requests
  - reset / forget commands
- Stored facts must remain scoped to the active project and not imply long-term reuse of client assets.

### Human handoff

- `Talk to a human` must be a persistent, visually clear CTA button.
- Clicking it should immediately switch the same panel into human-support mode.
- After handoff, AI must stop answering as if it were a human.
- The UI should show explicit status states such as:
  - connected to team
  - message delivered to team
  - awaiting reply
  - replied by team
- True read receipts should not be claimed unless they are actually measurable from Telegram.

### Telegram relay behavior

- A Telegram topic is created only when the user sends the first message in human-support mode.
- Exactly one topic must exist per real session.
- All later messages for that session must reuse the same topic.
- If topic creation races happen, the system must resolve them deterministically and cleanly.
- Team replies in that topic route back into the widget.
- The fallback path for non-topic messages must still preserve message persistence so replies can be matched.

### Topic naming and formatting

- Topic titles should be scannable, concise, and status-aware.
- Current preferred format:
  - `🆕 Name / Company (ShortID)`
  - `✅ Name / Company (ShortID)`
  - `⏳ Name / Company (ShortID)`
  - `🚫 Name / Company (ShortID)`
  - `❌ Name / Company (ShortID)`
- If one value is missing, degrade gracefully:
  - `🆕 Name (ShortID)`
  - `🆕 Company (ShortID)`
  - `🆕 New inquiry (ShortID)`
- Topic colors should reinforce status when supported.
- Telegram message bodies should use HTML formatting with:
  - short header
  - quoted user message body
  - monospace short session ID

### Supabase hygiene

- Do not persist empty or trivial sessions on mere widget open.
- Create sessions only after meaningful user interaction.
- Do not persist leads without both:
  - contact signal
  - project substance
- Keep instrumentation but bias toward quality over volume.

### Trust instrumentation

- Track both efficiency and trust signals:
  - completion rate
  - handoff rate
  - escalation frequency
  - response latency
  - memory correction frequency
  - reset frequency
  - helpfulness / clarity / trust feedback
- This is continuous product work, not a one-off launch.

## Architecture Decisions

### AI mode and human mode are hard-separated

- `AI intake` mode handles brief capture, summaries, memory, guardrails, and guided follow-ups.
- `Human support` mode handles Telegram relay only.
- No LLM responses are allowed while in active human mode.

### Telegram is the source of truth for human replies

- The widget sends outbound human-mode messages through the relay endpoint.
- Telegram topics become the human-team workspace.
- Team replies in Telegram flow back through webhook -> Supabase -> widget polling.

### Sessions are the root entity

- Every persisted human interaction maps to a single session row.
- Telegram thread IDs, contact name, and contact company are attached to sessions so topic naming can evolve over time.

### Fallbacks must not silently drop messages

- Even if topic creation fails, the system still sends the message and attempts to persist enough metadata for later matching.
- Errors must be logged explicitly.

## UX States

### AI intake states

- intro
- collecting overview
- collecting goals / audience
- collecting constraints
- collecting assets
- summarizing / qualifying

### Human mode states

- `connected to team`
- `message delivered to team`
- `awaiting reply`
- `replied by team`

These should be framed as delivery states, not AI-generated human simulations.

## Topic Lifecycle

- No topic on widget open
- No topic on human button click alone
- Topic created on first human-mode message
- Topic renamed as name/company is learned
- Topic renamed again on qualification result
- Existing topic always reused for the session
- Orphan topic creation must be prevented and cleanup tools must exist

## Telegram Formatting Best Practices Applied

- Use HTML parse mode consistently
- Escape user text before interpolation
- Prefer `<b>` for headers, `<blockquote>` for content, `<code>` for short IDs
- Avoid over-formatting and decorative clutter
- Keep messages short enough for quick scanning in support contexts
- Avoid putting sensitive detail in topic titles or push-notification-visible text

## Open Operational Notes

- Read state from Telegram is not robust enough to present true `seen` receipts today; only delivery / reply states should be shown.
- Forum topics require:
  - a forum-enabled group
  - bot admin rights with topic management
- Topic cleanup should be available through authenticated maintenance endpoints.
