# Trust-Centered Widget Remediation Design

## Goal

Restore the Balance Assist session and human-contact paths, then reshape the
experience around the thesis's trust principles using the supplied visual
reference as a style direction rather than a layout specification.

## Expert Review

The design incorporates independent reviews from five perspectives:

- product and UI/UX;
- full-stack reliability;
- accessibility and adversarial interaction testing;
- AI trust, privacy, and governance;
- conversation design for creative-agency onboarding.

Any unresolved P0 functional, privacy, human-agency, or truthfulness finding
blocks production promotion.

## Current Failures

### Session Bootstrap

Production `POST /api/sessions` returns
`session_rate_limit_identity_unavailable`. Vercel is missing the required
`TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for` configuration, so the route
fails before parsing, rate limiting, or Supabase persistence.

### Human Contact

The human path shares the failed session bootstrap and then has further gaps:

- the Vercel production origin is not trusted;
- required cross-origin headers are incomplete;
- Telegram topic creation is not part of dispatch;
- Telegram provider message IDs are not persisted for reply correlation;
- queued messages are described as delivered;
- the action does not make the AI bypass and fallback options clear.

## Product Position

Balance Assist is a bounded AI brief assistant, not a replacement producer,
sales decision-maker, legal adviser, or confidential intake channel. It helps
prospective clients organise a non-confidential, high-level project brief. A
human producer remains responsible for scope, timing, pricing, availability,
contracts, creative judgement, and relationship management.

The product tests the thesis question through visible trust mechanisms:

- explicit AI identity and precise role;
- warm, brand-aligned, clearly non-human language;
- context-aware questions and summaries;
- transparent, controllable temporary memory;
- responsive progress and honest status;
- reasons for sensitive questions;
- obvious human agency and escalation;
- safe boundaries and deterministic refusals;
- modest, sourced social proof;
- trust-oriented feedback and review.

## Entry Experience

The first meaningful screen presents two equal paths before AI consent:

1. **Build a brief with AI**
2. **Talk to the team without AI**

The human path opens an in-widget relay that bypasses DeepSeek. It also exposes
email and Calendly fallbacks that remain usable when session, Telegram, AI, or
polling services fail.

The AI path gives a concise, just-in-time disclosure before the first input:

> I am Balance Assist, Balance Studio's AI brief assistant. DeepSeek processes
> AI-mode messages and text extracted from supported files. Use this for
> non-confidential, high-level project information only. For NDA-bound,
> personal, unreleased, or sensitive material, talk to the team instead. A
> producer confirms scope, timing, pricing, availability, and contracts.

Actions are `Continue with AI`, `Talk to the team without AI`, and `Leave`.

## Visual Direction

Use the reference image as a visual compass:

- black and charcoal architectural surfaces;
- restrained warm gold for focus and action;
- thin, high-contrast borders;
- condensed display typography for headings and navigation;
- a legible sans serif for conversation and form content;
- an editorial serif only for sparse emphasis;
- compact but readable information density;
- minimal corner radii and limited glow;
- clear hierarchy across launcher, panel, brief rail, and mobile sheet.

Do not copy the reference layout, shrink text to create density, or add fake
human presence. Remove the generic green `Online` signal and simulated human
typing. Use factual labels such as `AI brief assistant`, `Generating an AI
response`, `Producer requested`, and `Waiting for a Balance team reply`.

## Desktop And Mobile

Desktop starts as a focused single panel. Once project intent exists, it opens
an adjacent structured brief rail. The rail groups project, objective and
audience, outputs, constraints, contact, references, and open questions.

Mobile opens as a full-screen sheet with Chat and Brief tabs. Copy refers to
the Brief tab rather than a left panel. Controls have at least 44 by 44 CSS
pixel targets, support safe areas and software keyboards, and remain usable at
320 CSS pixels and 200 percent zoom.

Reduced-motion mode removes smooth scrolling, transforms, and continuous dots
while preserving textual status.

## Intake And Summary

The intake has four visible stages:

1. project and objective;
2. audience and intended outputs;
3. timeline and budget;
4. references and contact.

Timeline and budget questions explain why the information helps. `Not sure
yet`, skip, and `Prefer not to share` are valid answers and do not block human
access.

The review rail distinguishes `Core brief ready` from optional details. It does
not expose score, qualified, misfit, unqualified, CRM, Telegram, or revision
terminology. Long fields use multiline editing. AI interpretation is labelled
`AI-drafted summary`, and the user's original wording remains available.

The send action is `Send brief to Balance`. A saved or queued brief is never
described as producer-reviewed.

## Memory And Consent

Temporary memory is visible, bounded, and controllable. The UI shows captured
fields, expiry after the latest authenticated activity, and controls for view,
edit, clear draft, withdraw transfer consent, and request deletion.

Clearing a draft is not described as deleting uploads, links, consent history,
approved records, provider copies, or backups.

Consent is separated by purpose:

- AI message processing;
- file analysis;
- a human-mode Telegram message;
- final brief transfer to Balance;
- Monday CRM transfer.

Human contact does not silently grant final brief or Monday transfer consent.

## Files And Confidentiality

NDA and confidentiality guidance appears before the first AI input and file
selector. The UI states the actual accepted formats and limits. It distinguishes
raw files from text extracted for AI analysis and from details later included in
an approved brief.

No wording may claim that a raw file is invisible to all providers when its
extracted text is processed by DeepSeek.

## Human Relay

Human mode bypasses DeepSeek. A message is stored in Supabase and queued to a
private Balance Telegram group. Dispatch must:

- create or recover the session's Telegram topic;
- send in the resolved thread;
- persist Telegram's provider message ID;
- correlate webhook replies by thread or provider message ID;
- retry topic or send failures without losing correlation.

Statuses are distinct and factual:

- `Message saved`;
- `Queued for the Balance team`;
- `Delivered to the Balance team`;
- `A team member replied`.

The interface does not promise an immediate reply or show a human typing state
without a real provider signal.

## Deletion

A deletion request atomically:

- freezes further chat and finalization;
- revokes active session consents;
- suppresses unsent handoff work;
- creates a durable deletion job;
- returns a receipt and visible status.

Copy distinguishes request, processing, local completion, provider retention,
and provider escalation. It does not guarantee completion within 24 hours.

## Error Handling

Errors identify what was saved, what failed, and the available next action.
Session failure always leaves direct email and Calendly available. Approval
failure re-enables its action. Errors remain visible in both mobile tabs.

Runtime states are modelled explicitly rather than inferred from message count:
notice, choice, session starting, AI intake, human requested, relay queued,
relay delivered, replied, approval pending, approved by user, and unavailable.

## Reliability

Production configuration must include and verify:

- `TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for`;
- the supported production origins;
- required CORS headers;
- Supabase service-role and RPC readiness;
- private upload storage readiness;
- Telegram webhook, topic, dispatch, and reply correlation;
- Monday and Calendly configuration.

Release smoke tests exercise real readiness rather than relying only on the
unconditional health endpoint.

## Accessibility

The release requires:

- keyboard access and visible focus for every action;
- focus entry into and restoration from Calendly;
- programmatic speaker labels and named transcript log;
- announced checking, queued, delivered, replied, loading, and error states;
- high-contrast control boundaries and focus indicators;
- reduced-motion behavior;
- 320px reflow, landscape, zoom, safe-area, and software-keyboard checks;
- equivalent fallback for third-party scheduling and human contact.

## Verification

TDD covers both reported failures and every behavior change. Mandatory journey
tests cover:

- AI and human entry paths before AI consent;
- production-like session bootstrap;
- NDA diversion before provider processing;
- four-stage intake, summaries, edits, retry, and reapproval;
- Telegram topic creation, delivery receipt, webhook reply, and polling;
- Calendly keyboard use and fallback;
- reset, withdrawal, deletion freeze, and deletion status;
- desktop and mobile interaction;
- visual regression and accessibility scans.

Independent reviewers repeat product/UX, engineering, accessibility,
conversation, and trust/privacy assessments before production promotion.

## Rollout

1. Restore and prove production session readiness.
2. Restore and prove human-without-AI relay and fallbacks.
3. Implement trust, copy, memory, consent, and deletion corrections.
4. Apply the reference-inspired desktop and mobile visual system.
5. Run full automated, production-smoke, accessibility, and red-team gates.
6. Promote only when no P0 or P1 release blocker remains.

## Non-Goals

- Long-term identity-based memory.
- NDA-bound file intake through AI.
- Automated pricing, availability, contracts, or creative decisions.
- A full replacement of the existing durable backend.
- Pixel-copying the reference image.
