# Balance Assist Design

## Goal

Build a semi-functional proof-of-concept for `Balance Assist`, a premium AI-assisted onboarding experience for the Balance website that qualifies leads, captures project briefs, accepts files, and routes qualified inquiries to Monday.com, Telegram, and Calendly.

## Product Positioning

- Product name in all surfaces: `Balance Assist`
- Role: AI-assisted project onboarding, not a generic chatbot
- Interaction model: workflow-first, chat-second
- Outcome: structured intake with human-led follow-through

## Core Design Principles

- Reduce LLM usage as much as possible without reducing user clarity
- Prefer deterministic flows, rules, templates, and approved content over generation
- Keep human escalation visible at all times
- Match the Balance website's premium, cinematic brand language
- Use browser/session memory only for MVP
- Treat files as supporting project evidence, not as a reason to force open-ended chat

## Brand Reference

### Visual Tokens

- Base black: `#101010`
- Charcoal: `#1d1d1d`
- Warm gold: `#dbb580`
- Light gold: `#ffd293`
- Light text: `#f2f2f2`
- Overlay: `rgba(0,0,0,.7)`

### Typography

- UI/body/labels: `Futura PT`
- Buttons/chips: `Futura PT Condensed`
- Editorial display, used sparingly: `Calluna`

### Tone

- Premium
- Cinematic
- Restrained
- Formal but approachable
- Business-facing

## Experience Model

The UI should not open into a blank chat transcript. Instead, it should guide users into one of four structured entry points:

1. `Start your project brief`
2. `Ask about services`
3. `Share a deck or brief`
4. `Talk to a human`

The system should capture lead data through guided modules, chips, summaries, file states, and deterministic rules. Free text remains available, but is visually secondary.

## Architecture

### Frontend

- Small Squarespace loader script
- Lazy-loaded iframe widget hosted separately
- Next.js App Router app for widget UI and API
- Mobile-first right panel / full-screen sheet patterns

### Backend

- Next.js route handlers in TypeScript
- Supabase Postgres for sessions, messages, leads, uploads, events, logs
- Supabase Storage for files
- Server-side Minimax access only

### Integrations

- Monday.com: one structured item per qualified lead
- Telegram Bot API: alert for qualified or urgent leads
- Calendly: inline or linked scheduling handoff

## Low-LLM Orchestration Rules

### Default Non-LLM Paths

- Intent routing: button-first, rule-based fallback
- Qualification: deterministic scorecard
- Service Q&A: approved content map
- Budget guidance: rules matrix
- Timeline guidance: rules matrix
- Handoff copy: templates
- CRM payload creation: structured mapping
- Frustration detection: rule and phrase matching

### Allowed LLM Uses

- Normalize long, messy free-text project briefs into structured fields
- Summarize extracted file text when parsing succeeds
- Produce a short nuance summary for internal handoff when needed

### Disallowed LLM Uses

- Deciding the next required question in normal guided flows
- Basic qualification logic
- Core pricing / timeline estimation
- Generic service FAQ answers where approved content exists
- Escalation triggers

## Main User Flows

### 1. New Business Lead

- User opens Balance Assist
- Sees AI disclosure and storage notice
- Chooses service / onboarding route
- Completes essentials: scope, timeline, budget, contact details
- Optionally uploads files or adds Google links
- Receives indicative guidance with disclaimer
- Gets next-step actions: book call, request follow-up, continue refining
- Qualified leads sync to Monday and Telegram

### 2. Misfit Visitor

- User asks about careers, vendor matters, or unrelated topics
- System identifies non-sales intent
- Routes to correct email, page, or contact path

### 3. Frustrated or Complex User

- User expresses frustration, confusion, or asks for a human
- System immediately exposes handoff path
- Existing captured brief is preserved

## Qualification Model

Use a deterministic scorecard over five dimensions:

- service relevance
- budget realism
- timeline fit
- completeness of brief
- seriousness of inquiry

Status outputs:

- `qualified`
- `needs_review`
- `misfit`
- `unqualified`

## File Handling

- Accept PDF upload, deck upload where feasible, and Google file links
- Parse text deterministically first
- Label summaries as `From your file` vs `My inference`
- If parsing fails, continue the flow and preserve the file for human review

## UI States

- Launcher
- Welcome panel
- Guided essentials flow
- File upload and review
- Project summary and next steps
- Mobile full-screen variant

## MVP Boundaries

- Browser/session memory only
- No user accounts
- No cross-session verified memory yet
- No broad retrieval over internal proprietary docs yet
- No autonomous proposal or quotation generation

## Success Criteria

- Users can complete a structured project brief with low friction
- Balance Assist feels visually consistent with the live Balance website
- The product depends on deterministic flows first, not open-ended LLM chat
- Qualified leads reliably create Monday items and Telegram alerts
- Human escalation is always visible and easy
