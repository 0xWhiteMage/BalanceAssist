# Final Review App Hardening Design

## Approval Ownership

Migration 055 returns `approved_draft_version`, `approval_input_hash`, and
`approved_reference_set_hash`. The finalize route must expose those values and
the client must reject persisted success responses that omit them. Approval
completion captures the current draft version and canonical reference hash in
its token. It accepts success only when the server's approved version and
reference hash match that token and the still-current canonical state. A
mismatch moves approval to error and reloads canonical state; it never derives
approval facts from local metadata. Accepted approval state stores the exact
server version, hashes, and CRM revision.

## Scope Preservation

Use one exported 4,000-character limit for the original `projectScope` across
the chat input, chat request contract, tool schema, and draft sanitizer. Values
within that boundary round-trip unchanged. Generated summaries such as
`scopePolished` may retain a lower explicit cap. Other short structured fields
retain their existing limits.

## Reference State

Both the chat attachment dropzone and inline brief manager use the overlay's
private-reference mutation. An add is complete only after the HTTPS link is
persisted and canonical `referencesStatus` is saved as `added`; partial failure
is visible and retryable. Removal updates status from the remaining persisted
links: `added` while any supported HTTPS reference remains, otherwise
`skipped`, explicitly meaning no references currently. Hydration reconciles
links and status from canonical server state.

## HTTPS Boundary

Reference creation accepts HTTPS only and stores the same normalized URL shape
used by finalization. HTTP, FTP, malformed, credential-bearing, and unsupported
URLs return a stable 400 response. Client errors explicitly request HTTPS.
Legacy non-HTTPS links remain visible and removable, are marked unsupported,
and are excluded from claims that references are transferable.

## Verification

Each behavior starts with a failing regression test. Coverage includes finalize
route/client strictness, concurrent approval mismatches, 4,000-character scope
round trips, both reference add paths and last-link removal, hydration
consistency, protocol rejection/normalization, and legacy rendering. Run
focused tests after each change, then API/conversation/widget suites, the full
test suite, TypeScript, lint, and diff validation before the implementation
commit.
