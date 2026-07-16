# Truthful Relay Status Recovery Design

**Date:** 2026-07-17

**Status:** Approved

## Goal

Restore truthful human-relay recovery without widening the public provider
surface or making human contact depend on session creation.

## Bounded Design

- The relay polling/status API returns only sanitized, persisted outgoing state
  (`queued` or `delivered`) and a sanitized team reply when one exists.
- `queued` means the durable relay/outbox record exists. `delivered` requires a
  durable successful outbox result or persisted provider receipt; request
  acceptance, an in-memory result, or elapsed time is not delivery evidence.
- Public responses never include provider message or thread IDs, provider error
  bodies, tokens, capabilities, internal routing data, or raw diagnostics.
- If human-session creation fails, the widget remains in human mode, explains
  that relay messaging is unavailable, and keeps direct email and Calendly
  actions persistently available.
- The AI, human, and leave entry actions have equal visual hierarchy. Each has
  a touch target of at least 44 by 44 CSS pixels on mobile, with equivalent
  keyboard and visible-focus behavior.
- The stale contract fixture is updated to the bounded response shape, and
  behavior tests cover status evidence, fallback persistence, and entry-action
  parity.

## Data Flow

1. A human-mode message is persisted with its durable outbox work before the UI
   can report `queued`.
2. The dispatcher sends the queued work to the provider and durably records the
   successful outbox outcome or provider receipt needed to prove delivery.
3. A provider webhook durably correlates and stores a sanitized team reply.
4. Authenticated polling reads canonical persisted records, derives `queued` or
   `delivered` from that evidence, attaches the sanitized reply when present,
   and maps the result to the narrow public contract.
5. The widget renders only the returned factual status and reply; it does not
   infer delivery from polling success, retries, time, or local state.

## Error Behavior

- Polling failures retain the last persisted status already shown and present a
  retryable, nonsensitive unavailable state; they never promote `queued` to
  `delivered`.
- Missing or inconclusive delivery evidence remains `queued`.
- Session creation failure does not redirect to AI mode, dismiss human mode, or
  hide recovery choices. Relay input may be disabled, but email and Calendly
  remain visible and actionable for the duration of the human-mode view.
- Provider and persistence failures use stable public error copy while detailed
  diagnostics remain server-side and sanitized.

## Security And Privacy

Polling remains authenticated and scoped to the current persisted session.
Server-side projection uses an allowlist so neither records nor exceptions are
serialized directly. Replies are normalized and sanitized before public
return. Logs and API responses exclude provider identifiers, errors, tokens,
capabilities, credentials, and internal correlation or routing metadata.

## Tests

- Update the stale relay status contract fixture to contain only outgoing
  `queued`/`delivered` state and the optional sanitized reply.
- Verify queued persistence produces `queued`, while only a durable successful
  outbox result or provider receipt produces `delivered`.
- Verify provider IDs, errors, tokens, capabilities, and internal metadata are
  absent from success and error responses.
- Verify a persisted reply is returned sanitized and correctly scoped, and an
  unrelated session cannot read it.
- Verify polling errors and incomplete evidence never fabricate delivery.
- Verify human-session failure preserves human mode and persistent, functional
  email and Calendly fallbacks.
- Verify AI, human, and leave actions have equal hierarchy, keyboard focus, and
  mobile targets of at least 44 by 44 CSS pixels.

## Non-Goals

This change does not expose provider telemetry, add new public relay states,
promise response times, redesign the relay transport, or make email and
Calendly depend on relay/session recovery.
