# Analysis-Only Temporary Uploads Design

## Goal

Accept validated files only for private, temporary analysis of the current draft. Files are never sent to producers or Telegram.

## Design

The upload route will read and validate server-side bytes once, live-attest the private bucket and policy state at each upload, then persist opaque objects and metadata. It will extract bounded text solely from those validated bytes, return a bounded safe payload, and the widget will pass it to its draft-analysis callback. The existing overlay callback owns application of that result to the draft.

When a multi-file request fails after one or more stores, the route will delete every object and metadata record it created in that request before reporting failure. If compensation cannot be completed, it will fail closed and preserve recovery records. No delivery code, producer consent, or Telegram API is part of this flow.

The file UI will expose only analysis consent and explicit temporary-retention copy. Link submission will retain its independent producer-transfer consent control.

## Safety And Tests

Live readiness verification must reject unavailable, public, or policy-drifted storage at POST time. Tests will cover consent success, opaque metadata, validation rejection, readiness failure, rollback failure, draft callback invocation, and batch compensation. Extraction remains character-bounded and does not trust client-provided extracted text.
