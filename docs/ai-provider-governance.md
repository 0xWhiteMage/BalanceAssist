# AI Provider Governance

## Approved Provider

Balance Assist AI mode uses DeepSeek only. Provider-dependent chat is sent to
`https://api.deepseek.com/v1/chat/completions` using `DEEPSEEK_API_KEY` and the
model configured by `DEEPSEEK_MODEL` (default `deepseek-v4-flash`).

MiniMax and OpenAI credentials do not select a chat provider and are not fallback
routes. If DeepSeek is missing, unavailable, times out, or rejects a request,
provider-dependent chat returns a redacted unavailable response. It must not send
the request to another provider. Deterministic in-process answers may still run
when an existing local route applies because they do not transmit content.

## Intake Boundary

AI mode accepts non-confidential, high-level project information only. NDA-bound,
confidential, unreleased, personal-data, and sensitive intent is diverted to the
human-only route before prompt construction or provider processing. The diversion
does not quote user text or reveal classifier rules.

Provider-dependent chat sends DeepSeek only the server-built system prompt and
the current last user message. Earlier browser-owned message history is not sent
to DeepSeek and is not part of confidential-intent classification. Separate
requests are never concatenated into provider input. A confidential-diversion
response stops AI processing and shows human-only contact options, but it does
not record human-contact consent or start the private relay until the user
explicitly chooses `Talk to the team without AI`.

Human mode bypasses DeepSeek. Its private relay, consent, retention, and producer
transfer controls remain separate from AI mode.

## Attachments

The AI attachment path accepts PNG, JPEG, GIF, WebP, PDF, plain text, and CSV;
at most five files, 10 MB each, and 25 MB total. Accepted files are validated and
stored privately for the temporary retention period. Server-side extraction is
capped at 4,000 characters. TXT and PDF can currently yield extracted text;
accepted images and CSV may yield none. Extracted text used in AI mode is sent to
DeepSeek.

Filename intent checks, consent, validation, private storage, and extraction do
not prove a file is non-confidential. Users must use the human-only path for
protected material.

## Output Boundary

The system prompt forbids legal or contract advice and commitments about pricing,
guaranteed timing, or availability. A deterministic reply sanitizer replaces
prohibited provider claims with producer-review language and discards associated
draft updates. Provider errors and logs must not expose credentials, provider
bodies, user content, or alternate-provider details.
