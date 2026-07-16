# Confidential Intake Boundary Design

## Goal

Keep NDA-bound, confidential, unreleased, personal, and sensitive material out
of AI processing while preserving a clear human-only route. DeepSeek remains the
only disclosed AI provider; producers retain legal, pricing, timing,
availability, and contract decisions.

## Scope

Task 5 adds a shared deterministic intent classifier, server and attachment UI
guards, accurate upload disclosure, provider governance, and prompt/output
boundary tests. It does not inspect file contents for confidentiality, create a
new secure document portal, or change the human relay.

## Classifier

A pure shared module returns either `allow` or a reason category without
retaining the input. It normalizes case, whitespace, punctuation, apostrophes,
and common hyphenation, then uses bounded phrases for explicit intent:

- NDA and non-disclosure restrictions;
- material explicitly described as confidential;
- unreleased projects, campaigns, products, or media;
- personal data or identifying/contact details;
- sensitive information, data, documents, or material.

Matching is precision-first. Generic uses such as "personal project", "sensitive
topic", "private event", portfolio confidentiality discussions, and explicit
negations such as "this is not confidential" do not divert unless another
positive phrase is present. Tests define positive, negative, negated, mixed-case,
punctuation, and substring cases so broad keyword matching cannot silently grow.
The UI and server import this same function; there are no separate regex sets.

## Data Flow

### Chat

1. Authenticate the request and enforce the existing origin/session boundary.
2. Read the bounded body and validate the shared request schema and session ID.
3. Classify only the current, last user message.
4. On a match, return the normal successful chat response shape with a stable
   diversion: this channel cannot process confidential or sensitive material;
   use the human-only path. Do not quote the message or identify the matched
   phrase.
5. Return before rate-limit work, FAQ routing, draft loading or persistence,
   prompt/message construction, provider configuration, provider calls, and any
   content-bearing log or event.
6. Otherwise continue through the existing deterministic routes and AI flow.

The server is authoritative. Client checks improve immediacy but never replace
the route guard.

### Attachments

The dropzone presents the non-confidential boundary, accepted formats, limits,
and extraction/provider flow before its selector. Before opening the selector,
it applies the shared classifier to available current-message context; a match
shows the same human-only diversion. After selection, file names are classified
before consent persistence, `arrayBuffer()`, validation, extraction, storage, or
upload. A match clears the input and performs none of those operations.

The disclosure reflects the current analysis path: PNG, JPEG, GIF, WebP, PDF,
plain text, and CSV; at most five files, 10 MB each and 25 MB total. Files are
validated and stored privately for the temporary retention period. Text is
extracted server-side where supported and capped at 4,000 characters; currently
TXT and PDF can yield text, while accepted images and CSV may yield no extracted
text. Any extracted text supplied to AI mode is processed by DeepSeek. The UI
must not imply that consent, filename checks, private storage, or extraction can
prove a file is non-confidential.

## Provider And Response Boundaries

AI chat is pinned to DeepSeek's explicit endpoint and configured model, and the
data-use notice and provider-governance document name DeepSeek. MiniMax or OpenAI
credentials must never cause runtime selection or fallback. If DeepSeek is
unconfigured, unavailable, times out, or rejects a request, provider-dependent
chat returns a stable, redacted unavailable error; it does not send the content
to another provider. In-process deterministic answers are not provider
fallbacks and remain permissible when their existing route is applicable.

The system prompt continues to forbid legal or contract advice and commitments
about pricing, timing, or availability. The deterministic reply sanitizer is a
second boundary: it replaces prohibited legal, pricing, guaranteed timing, and
availability claims with stable producer-review language and discards associated
draft updates. Confidential-intent diversion occurs before the prompt and is not
delegated to the model or sanitizer.

## Error Handling

Classification is synchronous and deterministic. An unexpected classifier
failure must not fall through to AI or file processing; return a generic
human-only diversion. UI failures leave the selector closed and preserve direct
human contact. Provider errors expose no provider body, credential, user text,
or alternate-provider details. Attachment validation/storage errors retain the
existing truthful retry/unavailable states and never weaken the guard.

## Security And Privacy

- Raw matched text, file names, extracted text, and matched phrases are not
  logged or emitted as telemetry.
- If diversion metrics are needed, emit only a bounded category after the
  response decision, with no free text or contact data.
- Authentication and schema limits remain ahead of classification to prevent
  unauthenticated probing and unbounded input work.
- The server check cannot be bypassed by disabling JavaScript or calling the API
  directly; the UI check cannot be treated as content inspection.
- Diversion responses are constant, non-echoing, and do not reveal classifier
  rules.
- Human mode bypasses DeepSeek and retains its separate relay disclosure and
  consent boundary.

## Tests

- Classifier unit tests cover every positive category, normalization, word
  boundaries, negation, benign near-matches, and combined phrases.
- Chat route tests prove auth/schema validation happens first, only the current
  user message is classified, diversion calls neither provider nor draft/event
  dependencies, and the response never echoes input.
- Provider tests prove DeepSeek is the sole AI endpoint, alternate credentials
  do not select another provider, and missing/failing DeepSeek does not trigger
  cross-provider fallback.
- Dropzone tests prove the disclosure matches runtime formats and limits, a
  context match prevents selector opening, and a filename match prevents byte
  reads, consent writes, extraction, storage, upload, and callbacks.
- Prompt and sanitizer tests retain legal, pricing, guaranteed timing, and
  availability boundaries, including adversarial provider outputs and empty
  draft updates after override.
- Governance/notice tests keep the named provider, human-only route, extraction
  statement, and non-confidential warning aligned.

## Non-Goals

- Detecting secrets or sensitive meaning inside file bytes.
- Accepting NDA-bound material through AI after an extra confirmation.
- Replacing legal review, producer decisions, or the human-only intake path.
- Adding another model provider or automatic provider failover.
