# Authenticated Upload Parsing Design

## Goal

Prevent unauthenticated or untrusted multipart requests from reaching multipart parsing while retaining capability-scoped, analysis-only private uploads.

## Request Contract

`POST /api/telegram/upload` requires the existing session capability (cookie or `x-session-capability`) and an `x-session-id` header. The header is supplied by both upload clients and is passed to `requireSession` before the request body is read. The capability must resolve to exactly that session ID.

## Body Handling

The route rejects a numeric `Content-Length` larger than the multipart allowance before reading. For absent, invalid, or forged lengths, it wraps the request body in a byte-counting stream that cancels and fails once the same allowance is crossed; `formData()` receives only that bounded stream. Oversized bodies return `413` rather than an invalid-form response.

## Preserved Behavior

Once capability, origin, session scope, and body size pass, the route continues to require analysis consent and stores uploads only in private storage. No producer delivery behavior is added.

## Tests

Route tests spy on `formData()` to prove missing/invalid capability and wrong origin reject before parsing. They cover declared and chunked/missing-length oversize requests, then retain a valid analysis-consented private-upload assertion.
