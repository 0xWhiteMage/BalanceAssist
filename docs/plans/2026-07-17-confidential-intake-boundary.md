# Confidential Intake Boundary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent NDA-bound, confidential, unreleased, personal-data, and sensitive material from reaching AI processing while preserving a stable human-only diversion and truthful provider/upload disclosures.

**Architecture:** Add one pure shared precision-first classifier used by both the chat route and the AI attachment dropzone. Keep authentication, origin enforcement, bounded body parsing, shared schema validation, and session-ID validation ahead of classification; on a match, return before rate limiting, deterministic routing, draft access, persistence, provider setup/calls, events, or logs. Pin provider-dependent chat to DeepSeek, retain only genuinely deterministic in-process answers, and enforce prompt/output and attachment boundaries independently of the model.

**Tech Stack:** Next.js 15 route handlers, React 19, TypeScript 5, Zod, Vitest, Testing Library, Supabase, DeepSeek's OpenAI-compatible API.

---

## Ground Rules

- Work from `D:\Development Projects\Balance-Assist\.worktrees\confidential-intake-boundary`.
- Use @superpowers:test-driven-development for every behavior change: add one focused failing test, run it and inspect the expected failure, make the smallest implementation change, then rerun.
- Do not log, emit, persist, or quote matched message text, file names, extracted text, or matched phrases. Task 5 does not need a diversion metric; do not add one.
- Do not classify unauthenticated, wrong-origin, oversized, malformed, schema-invalid, or session-mismatched requests. The authoritative order is `requireSession` -> bounded body read -> shared Zod schema -> authenticated session-ID match -> classify the current last user message.
- Classify only `lastUserMessage`, not earlier message history, browser-owned draft context, server draft contents, links, or file bytes.
- Do not claim filename checks or user consent prove a file is non-confidential. The attachment guard is an intent boundary, not content inspection.
- Do not alter the separate human relay upload path in `lib/uploads/file-policy.ts` or `components/widget/widget-overlay.tsx:1015-1099`. Its broad 50 MB policy is not the AI analysis policy.
- Keep each commit limited to the files named by its task. Run `git diff --check` before every commit.

### Stable Copy

Use one exported constant everywhere the classifier diverts:

```ts
export const CONFIDENTIAL_INTAKE_RESPONSE =
  'This channel cannot process confidential or sensitive material. Please use the human-only path to talk to the Balance team.';
```

The copy is deliberately constant and non-echoing. Do not append a category, phrase, file name, or user text.

### Current-Code Constraints

- `app/api/chat/route.ts:484-505` already authenticates, bounds the request body, and validates `chatRequestPayloadSchema`; preserve that order.
- Move FAQ computation from current line 510 until after session mismatch and confidential-intent handling. Otherwise work is performed before the diversion boundary.
- `app/api/chat/route.ts:516` currently scans every message for careers intent. Confidential classification must still inspect only the last user message and run before this all-history careers route.
- `app/api/chat/route.ts:520-529` rate limiting and `getEnv()` must remain after diversion.
- `app/api/chat/route.ts:550-555` draft loading and prompt construction must remain after diversion.
- `app/api/chat/route.ts:578-595` currently selects MiniMax or OpenAI when DeepSeek is absent. Remove those runtime branches and their route-local MiniMax parser/caller.
- `components/widget/attachment-dropzone.tsx:150-169` currently persists consent and reads bytes before validation. Filename classification must precede all of those operations.
- `lib/uploads/quarantine.ts` is the source of truth for AI-analysis formats and limits. `lib/uploads/file-policy.ts` is a different human relay policy and must not supply dropzone disclosure.
- `lib/uploads/extract-text.ts:217-229` can extract accepted TXT and PDF files and caps output at 4,000 characters. Although it also contains dormant DOCX/PPTX extraction helpers, those formats are rejected by the active AI quarantine policy and must not be advertised.

## Task 1: Deterministic Classifier And Precision Tests

**Files:**
- Create: `lib/privacy/confidential-intent.ts`
- Create: `tests/privacy/confidential-intent.test.ts`

### Step 1: Write the failing classifier contract tests

Create `tests/privacy/confidential-intent.test.ts` with the complete table-driven contract below. These examples intentionally define both recall and precision; do not replace them with generic keyword assertions.

```ts
import { describe, expect, test } from 'vitest';
import {
  classifyConfidentialIntent,
  CONFIDENTIAL_INTAKE_RESPONSE,
  type ConfidentialIntentResult
} from '@/lib/privacy/confidential-intent';

describe('classifyConfidentialIntent', () => {
  test.each<[string, Exclude<ConfidentialIntentResult, 'allow'>]>([
    ['This project is under NDA.', 'nda'],
    ['These files are covered by a non-disclosure agreement', 'nda'],
    ['I need to share NDA-protected material', 'nda'],
    ['The attached brief contains confidential information.', 'confidential'],
    ['I am sending confidential client documents', 'confidential'],
    ['Our campaign details are strictly confidential', 'confidential'],
    ['This is an unreleased product campaign.', 'unreleased'],
    ['I want to upload pre-release footage', 'unreleased'],
    ['The project is unannounced media for launch', 'unreleased'],
    ['This file contains personal data.', 'personal-data'],
    ['I need to send identifying details', 'personal-data'],
    ['The brief includes private contact information', 'personal-data'],
    ['These documents contain sensitive information.', 'sensitive'],
    ['I am uploading sensitive client data', 'sensitive'],
    ['The attached material is highly sensitive', 'sensitive']
  ])('classifies %j as %s', (input, expected) => {
    expect(classifyConfidentialIntent(input)).toBe(expected);
  });

  test.each([
    'THIS PROJECT IS UNDER AN NDA',
    'This\tproject\nis under NDA.',
    'This project is under an N.D.A.',
    'This project is under a non disclosure agreement',
    'I am sharing pre–release footage',
    "I’m sending confidential client documents"
  ])('normalizes case, whitespace, punctuation, apostrophes, and hyphenation: %j', (input) => {
    expect(classifyConfidentialIntent(input)).not.toBe('allow');
  });

  test.each([
    'This is a personal project.',
    'That is a sensitive topic.',
    'We are planning a private event.',
    'How does Balance handle portfolio confidentiality?',
    'Can your producer review an NDA?',
    'This is not confidential.',
    'The project is no longer confidential.',
    'This contains no personal data.',
    'This document is not sensitive.',
    'The campaign has already been released.',
    'The candidate personalised the confidentially word.',
    'The class action is unconditional.',
    'We need a release form for filming.',
    'Please contact me about the project.'
  ])('allows benign, negated, and substring near-matches: %j', (input) => {
    expect(classifyConfidentialIntent(input)).toBe('allow');
  });

  test('does not let one negated phrase hide a separate positive phrase', () => {
    expect(
      classifyConfidentialIntent('The overview is not confidential, but the attached file contains personal data.')
    ).toBe('personal-data');
  });

  test('returns a stable non-echoing diversion message', () => {
    expect(CONFIDENTIAL_INTAKE_RESPONSE).toBe(
      'This channel cannot process confidential or sensitive material. Please use the human-only path to talk to the Balance team.'
    );
    expect(CONFIDENTIAL_INTAKE_RESPONSE).not.toMatch(/NDA-protected material/i);
  });
});
```

### Step 2: Run the test to verify RED

Run:

```powershell
npx vitest run tests/privacy/confidential-intent.test.ts
```

Expected RED: Vitest fails to resolve `@/lib/privacy/confidential-intent`.

### Step 3: Add the minimal pure classifier

Create `lib/privacy/confidential-intent.ts`. Keep all patterns private so callers receive only a bounded category. Normalization must not mutate, retain, log, or emit the source string.

```ts
export type ConfidentialIntentResult =
  | 'allow'
  | 'nda'
  | 'confidential'
  | 'unreleased'
  | 'personal-data'
  | 'sensitive';

export const CONFIDENTIAL_INTAKE_RESPONSE =
  'This channel cannot process confidential or sensitive material. Please use the human-only path to talk to the Balance team.';

const NEGATED_PHRASES = [
  /\b(?:is|are|was|were) not (?:strictly |highly )?confidential\b/g,
  /\bno longer (?:strictly |highly )?confidential\b/g,
  /\b(?:contains?|includes?|has|have) no personal data\b/g,
  /\b(?:does not|doesn't|do not|don't) contain personal data\b/g,
  /\b(?:is|are|was|were) not (?:highly )?sensitive\b/g,
  /\b(?:has|have) already been released\b/g,
  /\b(?:is|are|was|were) already released\b/g
];

const CATEGORY_PATTERNS: ReadonlyArray<{
  category: Exclude<ConfidentialIntentResult, 'allow'>;
  patterns: readonly RegExp[];
}> = [
  {
    category: 'nda',
    patterns: [
      /\b(?:under|covered by|subject to|bound by|protected by) (?:an? )?(?:nda|non disclosure agreement)\b/,
      /\b(?:nda|non disclosure agreement) protected (?:information|data|documents?|materials?|content|details|files?)\b/,
      /\b(?:share|send|upload|provide|process) (?:an? )?(?:nda|non disclosure agreement) (?:protected |restricted )?(?:information|data|documents?|materials?|content|details|files?)\b/
    ]
  },
  {
    category: 'confidential',
    patterns: [
      /\b(?:contains?|includes?|uploading|sharing|sending|providing|process(?:ing)?) (?:strictly |highly )?confidential (?:client )?(?:information|data|documents?|materials?|content|details|brief|files?)\b/,
      /\b(?:this|that|it|these|those) (?:is|are) (?:strictly |highly )?confidential\b/,
      /\b(?:the|our|my|client) (?:attached )?(?:project|brief|file|document|material|information|campaign|product)(?: details)? (?:is|are|contains?|includes?) (?:strictly |highly )?confidential(?: (?:information|data|documents?|materials?|content|details|brief|files?))?\b/,
      /\b(?:confidential client|client confidential) (?:information|data|documents?|materials?|content|details|brief|files?)\b/
    ]
  },
  {
    category: 'unreleased',
    patterns: [
      /\b(?:this|that|the|our|my|client|an?) (?:project|campaign|product|film|video|footage|media|asset|assets|creative|launch) (?:is|are) (?:unreleased|pre release|unannounced)\b/,
      /\b(?:this|that|it) (?:is|are) (?:an? )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/,
      /\b(?:share|send|upload|provide|process|contains?|includes?) (?:an? |the |our |my |client )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/,
      /\b(?:unreleased|pre release|unannounced) (?:client )?(?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/
    ]
  },
  {
    category: 'personal-data',
    patterns: [
      /\b(?:contains?|includes?|share|send|upload|provide|process(?:ing)?) (?:private )?(?:personal data|personally identifying information|identifying details|contact details|contact information)\b/,
      /\b(?:this|that|the|our|my|client) (?:attached )?(?:brief|file|document|material)? ?(?:contains?|includes?|has) (?:private )?(?:personal data|personally identifying information|identifying details|contact details|contact information)\b/
    ]
  },
  {
    category: 'sensitive',
    patterns: [
      /\b(?:contains?|includes?|share|send|upload|provide|process(?:ing)?) (?:highly )?sensitive (?:client )?(?:information|data|documents?|materials?|content|details|files?)\b/,
      /\b(?:this|that|it|these|those) (?:is|are) (?:highly )?sensitive\b/,
      /\b(?:the|our|my|client) (?:attached )?(?:brief|file|document|material|information|data)(?: details)? (?:is|are|contains?|includes?) (?:highly )?sensitive(?: (?:information|data|documents?|materials?|content|details|files?))?\b/
    ]
  }
];

function normalizeForClassification(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\bn\s*[.\-]?\s*d\s*[.\-]?\s*a\b/g, 'nda')
    .replace(/[‐‑‒–—−-]+/g, ' ')
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyConfidentialIntent(value: string): ConfidentialIntentResult {
  let normalized = normalizeForClassification(value);
  for (const pattern of NEGATED_PHRASES) {
    normalized = normalized.replace(pattern, ' ordinary ');
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();

  for (const rule of CATEGORY_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.category;
    }
  }
  return 'allow';
}
```

If any positive table row misses, tighten or add a bounded phrase for that exact grammatical form. Do not solve failures with standalone keyword patterns such as `/confidential/`, `/private/`, `/personal/`, or `/sensitive/`.

### Step 4: Run precision tests to verify GREEN

Run:

```powershell
npx vitest run tests/privacy/confidential-intent.test.ts
```

Expected GREEN: one test file passes; every positive category, normalization form, negation, benign phrase, and substring case passes.

### Step 5: Check and commit the classifier

Run:

```powershell
git diff --check
git add -- lib/privacy/confidential-intent.ts tests/privacy/confidential-intent.test.ts
git commit --message "feat: classify confidential intake intent"
```

Expected: one commit containing only the shared module and its unit test.

## Task 2: Chat Pre-Provider Enforcement And Stable Response

**Files:**
- Modify: `app/api/chat/route.ts:1-29,484-555`
- Modify: `tests/api/chat-route.test.ts:3-73,177-421`
- Test: `tests/api/chat-auth-order.test.ts`

### Step 1: Add failing route tests for ordering and side-effect isolation

In the hoisted mocks in `tests/api/chat-route.test.ts`, add a classifier mock that delegates to the real implementation by default. This lets one test prove fail-closed behavior without broad production hooks:

```ts
const {
  createServerSupabaseClientMock,
  hasSupabaseServerConfigMock,
  requireSessionMock,
  emitEventMock,
  consumeRateLimitMock,
  classifyConfidentialIntentMock
} = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  hasSupabaseServerConfigMock: vi.fn(() => false),
  requireSessionMock: vi.fn(),
  emitEventMock: vi.fn(),
  consumeRateLimitMock: vi.fn(),
  classifyConfidentialIntentMock: vi.fn()
}));

vi.mock('@/lib/privacy/confidential-intent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/privacy/confidential-intent')>();
  return {
    ...actual,
    classifyConfidentialIntent: classifyConfidentialIntentMock
  };
});
```

In `beforeEach`, restore deterministic delegation and clear event calls:

```ts
const actualClassifier = await import('@/lib/privacy/confidential-intent').then(
  (module) => module.classifyConfidentialIntent
);
```

Because the import above is mocked, do not use it to obtain the original. Instead, import the implementation before installing a mock only if Vitest permits it in this file, or use this explicit default in `beforeEach`:

```ts
classifyConfidentialIntentMock.mockReset();
classifyConfidentialIntentMock.mockImplementation((value: string) =>
  /under nda/i.test(value) ? 'nda' : 'allow'
);
emitEventMock.mockReset();
```

Then add these complete tests near the existing authentication/body-limit tests:

```ts
test('diverts the current confidential message before rate limiting, draft access, provider calls, events, or logs', async () => {
  const secret = 'Project NIGHTJAR is under NDA';
  const fromMock = vi.fn(() => {
    throw new Error('draft access must not occur');
  });
  requireSessionMock.mockResolvedValue({
    ok: true,
    auth: { sessionId: 'test-session', capability: 'test-session.secret' },
    supabase: { from: fromMock, rpc: vi.fn() }
  });
  process.env.DEEPSEEK_API_KEY = 'test-key';
  global.fetch = vi.fn();
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { res, data } = await postChat({
    messages: [{ role: 'user', content: secret }]
  });

  expect(res.status).toBe(200);
  expect(data).toEqual({
    message: 'This channel cannot process confidential or sensitive material. Please use the human-only path to talk to the Balance team.',
    draftUpdates: {},
    briefReady: false,
    reviewPrompt: null,
    missingFields: [],
    truncated: false
  });
  expect(JSON.stringify(data)).not.toContain('NIGHTJAR');
  expect(consumeRateLimitMock).not.toHaveBeenCalled();
  expect(fromMock).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(emitEventMock).not.toHaveBeenCalled();
  expect([...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ')).not.toContain(secret);

  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

test('classifies only the current last user message', async () => {
  global.fetch = vi.fn();
  const { res, data } = await postChat({
    messages: [
      { role: 'user', content: 'An earlier message was under NDA.' },
      { role: 'user', content: 'Can you do filming?' }
    ],
    context: { isTeamConnected: false }
  });

  expect(res.status).toBe(200);
  expect(data.messages).toBeDefined();
  expect(data.message).not.toMatch(/cannot process confidential/i);
  expect(classifyConfidentialIntentMock).toHaveBeenCalledOnce();
  expect(classifyConfidentialIntentMock).toHaveBeenCalledWith('Can you do filming?');
});

test('checks authenticated session mismatch before confidential classification', async () => {
  const { res, data } = await postChat({
    messages: [{ role: 'user', content: 'This project is under NDA.' }],
    context: { sessionId: 'another-session' }
  });

  expect(res.status).toBe(403);
  expect(data.error).toBe('Session mismatch');
  expect(classifyConfidentialIntentMock).not.toHaveBeenCalled();
  expect(consumeRateLimitMock).not.toHaveBeenCalled();
});

test('validates the shared request schema before confidential classification', async () => {
  const { res } = await postChat({
    messages: [{ role: 'assistant', content: 'This project is under NDA.' }]
  });

  expect(res.status).toBe(400);
  expect(classifyConfidentialIntentMock).not.toHaveBeenCalled();
  expect(consumeRateLimitMock).not.toHaveBeenCalled();
});

test('fails closed with the same diversion if classification throws', async () => {
  classifyConfidentialIntentMock.mockImplementationOnce(() => {
    throw new Error('classifier failure');
  });
  process.env.DEEPSEEK_API_KEY = 'test-key';
  global.fetch = vi.fn();

  const { res, data } = await postChat({
    messages: [{ role: 'user', content: 'ordinary project text' }]
  });

  expect(res.status).toBe(200);
  expect(data.message).toMatch(/cannot process confidential or sensitive material/i);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(consumeRateLimitMock).not.toHaveBeenCalled();
  expect(emitEventMock).not.toHaveBeenCalled();
});
```

Keep the existing `tests/api/chat-auth-order.test.ts` tests unchanged. They are independent integration proof that real `requireSession` rejects missing capabilities and untrusted origins before parsing/provider activity.

### Step 2: Run the route tests to verify RED

Run:

```powershell
npx vitest run tests/api/chat-route.test.ts tests/api/chat-auth-order.test.ts
```

Expected RED: diversion assertions fail because the request currently reaches rate limiting/routing/provider work; the classifier-order assertions also fail because the route does not import or invoke the classifier.

### Step 3: Add the authoritative guard in the exact request order

Import the shared API at the top of `app/api/chat/route.ts`:

```ts
import {
  classifyConfidentialIntent,
  CONFIDENTIAL_INTAKE_RESPONSE
} from '@/lib/privacy/confidential-intent';
```

Add one local response helper near the route constants so normal and classifier-failure paths cannot drift:

```ts
function confidentialDiversionResponse(request: Request) {
  return jsonWithCors({
    message: CONFIDENTIAL_INTAKE_RESPONSE,
    draftUpdates: {},
    briefReady: false,
    reviewPrompt: null,
    missingFields: [],
    truncated: false
  }, undefined, request);
}
```

Replace the current `POST` section from destructuring through FAQ calculation with this exact order:

```ts
const { messages, context } = parsed.data;
const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
const sessionId = session.auth.sessionId;

if (context?.sessionId && context.sessionId !== sessionId) {
  return jsonWithCors({ error: 'Session mismatch' }, { status: 403 }, request);
}

try {
  if (classifyConfidentialIntent(lastUserMessage) !== 'allow') {
    return confidentialDiversionResponse(request);
  }
} catch {
  return confidentialDiversionResponse(request);
}

const faqResponse = !context?.isTeamConnected ? getBalanceFaqResponse(lastUserMessage) : null;
```

The careers check, rate limiter, `getEnv`, FAQ return, `loadAuthenticatedDraftState`, `buildLlmContext`, provider message construction, persistence, and `logLlmEvent` must all remain below this block. Do not add a log/event in the classifier branch, including in `catch`.

### Step 4: Run route and classifier tests to verify GREEN

Run:

```powershell
npx vitest run tests/privacy/confidential-intent.test.ts tests/api/chat-route.test.ts tests/api/chat-auth-order.test.ts
```

Expected GREEN: all three files pass. In particular, auth/schema/session failures retain their existing status, and diversion returns the successful chat response shape without side effects.

### Step 5: Check and commit server enforcement

Run:

```powershell
git diff --check
git add -- app/api/chat/route.ts tests/api/chat-route.test.ts
git commit --message "feat: divert confidential chat before processing"
```

Expected: `tests/api/chat-auth-order.test.ts` remains unmodified and unstaged; the commit contains only route enforcement and route tests.

## Task 3: Provider Governance, Prompt, And Output Boundaries

**Files:**
- Modify: `app/api/chat/route.ts:89-293,529-659`
- Modify: `lib/env.ts:7-13`
- Modify: `lib/conversation/system-prompt.ts:89-114`
- Modify: `lib/conversation/reply-sanitize.ts:3-33,86-114`
- Modify: `lib/privacy/notice.ts:3-10`
- Create: `docs/ai-provider-governance.md`
- Modify: `tests/api/chat-route.test.ts:34-73,924-939`
- Modify: `tests/conversation/system-prompt.test.ts`
- Modify: `tests/conversation/reply-sanitize.test.ts`
- Modify: `tests/widget/data-use-notice.test.tsx`

### Step 1: Add failing provider-selection and unavailable-response tests

Extend environment save/restore in `tests/api/chat-route.test.ts` to cover alternate credentials so tests never leak process state:

```ts
let originalMinimaxKey: string | undefined;
let originalOpenAiKey: string | undefined;
let originalOpenAiEndpoint: string | undefined;

// beforeEach
originalMinimaxKey = process.env.MINIMAX_API_KEY;
originalOpenAiKey = process.env.OPENAI_API_KEY;
originalOpenAiEndpoint = process.env.OPENAI_API_ENDPOINT;
delete process.env.MINIMAX_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_ENDPOINT;

// afterEach
if (originalMinimaxKey === undefined) delete process.env.MINIMAX_API_KEY;
else process.env.MINIMAX_API_KEY = originalMinimaxKey;
if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
else process.env.OPENAI_API_KEY = originalOpenAiKey;
if (originalOpenAiEndpoint === undefined) delete process.env.OPENAI_API_ENDPOINT;
else process.env.OPENAI_API_ENDPOINT = originalOpenAiEndpoint;
```

Add the provider governance tests:

```ts
test('calls only the fixed DeepSeek endpoint and configured DeepSeek model', async () => {
  process.env.DEEPSEEK_API_KEY = 'deepseek-key';
  process.env.DEEPSEEK_MODEL = 'approved-deepseek-model';
  process.env.MINIMAX_API_KEY = 'minimax-key';
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.OPENAI_API_ENDPOINT = 'not-a-url-and-must-be-ignored';
  global.fetch = vi.fn(async () => makeTruncatedResponse('DeepSeek reply', 'stop')) as unknown as typeof fetch;

  const { res } = await postChat({
    messages: [{ role: 'user', content: 'Tell me about an unusual production approach' }]
  });

  expect(res.status).toBe(200);
  expect(global.fetch).toHaveBeenCalledOnce();
  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.deepseek.com/v1/chat/completions',
    expect.objectContaining({
      body: expect.stringContaining('"model":"approved-deepseek-model"')
    })
  );
  expect(String(vi.mocked(global.fetch).mock.calls[0][0])).not.toMatch(/minimax|openai|attacker/i);
});

test('does not select an alternate provider when DeepSeek is unconfigured', async () => {
  delete process.env.DEEPSEEK_API_KEY;
  process.env.MINIMAX_API_KEY = 'minimax-key';
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
  global.fetch = vi.fn();

  const { res, data } = await postChat({
    messages: [{ role: 'user', content: 'Invent a highly unusual production answer not covered locally' }]
  });

  expect(res.status).toBe(503);
  expect(data).toEqual({ error: 'Chat service unavailable', detail: 'chat_provider_unavailable' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('keeps an applicable deterministic answer when DeepSeek is unconfigured', async () => {
  delete process.env.DEEPSEEK_API_KEY;
  global.fetch = vi.fn();

  const { res, data } = await postChat({
    messages: [{ role: 'user', content: 'hello' }]
  });

  expect(res.status).toBe(200);
  expect(data.message).toBeTypeOf('string');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('returns one redacted unavailable error when DeepSeek rejects the request', async () => {
  process.env.DEEPSEEK_API_KEY = 'deepseek-key';
  process.env.MINIMAX_API_KEY = 'minimax-key';
  process.env.OPENAI_API_KEY = 'openai-key';
  global.fetch = vi.fn(async () => new Response('provider body SECRET-42', { status: 429 })) as unknown as typeof fetch;

  const { res, data } = await postChat({
    messages: [{ role: 'user', content: 'ordinary provider-dependent question' }]
  });

  expect(res.status).toBe(503);
  expect(data).toEqual({ error: 'Chat service unavailable', detail: 'chat_provider_unavailable' });
  expect(JSON.stringify(data)).not.toMatch(/SECRET-42|429|minimax|openai|deepseek-key/i);
  expect(global.fetch).toHaveBeenCalledOnce();
});
```

Choose the provider-dependent prompts above only after confirming `getLocalResponse` returns `null` for them. If a phrase gains a deterministic route, use another ordinary non-confidential prompt rather than weakening the assertion.

### Step 2: Add failing prompt, sanitizer, notice, and governance tests

Append to `tests/conversation/system-prompt.test.ts`:

```ts
test('system prompt forbids legal advice and producer commitments', () => {
  const prompt = buildSystemPrompt();
  expect(prompt).toMatch(/never provide legal advice/i);
  expect(prompt).toMatch(/contract terms/i);
  expect(prompt).toMatch(/specific pricing/i);
  expect(prompt).toMatch(/guaranteed timelines/i);
  expect(prompt).toMatch(/availability/i);
  expect(prompt).toMatch(/producer review/i);
});
```

Append to `tests/conversation/reply-sanitize.test.ts`:

```ts
test.each([
  ['The binding contract is legally enforceable and you should sign it.', /legal|contract.*producer/i],
  ['The final price is SGD 12,000.', /pricing.*producer/i],
  ['We guarantee delivery by 1 September.', /timing.*producer/i],
  ['The crew is definitely available next Friday.', /availability.*producer/i]
])('overrides prohibited provider claim and discards its draft: %s', (providerReply, expected) => {
  const result = sanitizeReply(providerReply, 'Tell me what you can commit to', {
    toolCallArguments: { projectScope: 'Secretly injected update' }
  });
  expect(result.overridden).toBe(true);
  expect(result.reply).toMatch(expected);
  expect(result.draft).toEqual({});
});
```

Append to `tests/widget/data-use-notice.test.tsx`:

```ts
test('names DeepSeek as the sole AI-mode processor and preserves the human-only route', () => {
  renderNotice();
  fireEvent.click(screen.getByRole('button', { name: 'Build a brief with AI' }));
  const notice = screen.getByTestId('data-use-notice');
  expect(notice).toHaveTextContent(/DeepSeek processes AI-mode messages/i);
  expect(notice).toHaveTextContent(/non-confidential, high-level project information only/i);
  expect(screen.getByRole('button', { name: 'Talk to the team without AI' })).toBeInTheDocument();
  expect(notice.textContent).not.toMatch(/MiniMax|OpenAI|fallback provider/i);
});
```

After creating `docs/ai-provider-governance.md` in the implementation step, add a lightweight governance assertion to `tests/api/chat-route.test.ts` only if the repository already has a docs-policy test convention. Otherwise verify it with the explicit `rg` command in Step 6 rather than importing Node filesystem APIs into a jsdom route suite.

### Step 3: Run focused tests to verify RED

Run:

```powershell
npx vitest run tests/api/chat-route.test.ts tests/conversation/system-prompt.test.ts tests/conversation/reply-sanitize.test.ts tests/widget/data-use-notice.test.tsx
```

Expected RED:

- alternate credentials currently trigger MiniMax/OpenAI calls;
- absent DeepSeek currently returns a generic local fallback instead of a provider-unavailable response when no deterministic route applies;
- provider rejection currently returns status 500 and `chat_provider_failed`;
- sanitizer does not yet cover guaranteed timing/availability claims precisely;
- prompt wording does not include all asserted producer-review boundaries.

### Step 4: Pin provider-dependent execution to DeepSeek

In `app/api/chat/route.ts`:

1. Delete `readMinimaxContent` and `callMinimax` in full.
2. Keep `callOpenAICompatible` because DeepSeek uses that wire format.
3. Add a stable constant near `PROVIDER_TIMEOUT_MS`:

```ts
const CHAT_PROVIDER_UNAVAILABLE = {
  error: 'Chat service unavailable',
  detail: 'chat_provider_unavailable'
} as const;
```

4. Replace the current provider selection block with a deterministic-first missing-key branch and one DeepSeek branch:

```ts
const llmMessages = [{ role: 'system' as const, content: llmContext.systemPrompt }, ...messages];

if (!env.DEEPSEEK_API_KEY) {
  const localResponse = getLocalResponse(lastUserMessage, {
    draft: llmContext.priorDraft as never,
    step: (context?.step as ConversationStepId) ?? 'free-chat',
    isTeamConnected: context?.isTeamConnected ?? false
  });

  if (localResponse) {
    category = 'local_fallback';
    visibleContent = localResponse;
  } else if (context?.step && conversationSteps[context.step as ConversationStepId]?.quickReplies) {
    category = 'local_fallback';
    visibleContent = "I didn't quite catch that - could you pick one of the options above, or tell me about your project?";
  } else {
    return jsonWithCors(CHAT_PROVIDER_UNAVAILABLE, { status: 503 }, request);
  }
} else {
  const providerResult = await callOpenAICompatible(
    'https://api.deepseek.com/v1/chat/completions',
    env.DEEPSEEK_API_KEY,
    env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
    llmMessages,
    { useTools: true, sessionId, priorDraft: llmContext.priorDraft, userMessage: lastUserMessage, requestId }
  );
  visibleContent = providerResult.content;
  toolArguments = providerResult.toolArguments;
  sharedWork = providerResult.sharedWork;
  truncated = providerResult.truncated;
}
```

5. Replace the route catch response with the same redacted unavailable contract:

```ts
} catch {
  return jsonWithCors(CHAT_PROVIDER_UNAVAILABLE, { status: 503 }, request);
}
```

Do not include the caught error, provider response body, endpoint, API key, model, user text, or alternate-provider state in the response or logs. Exact repository search shows the MiniMax/OpenAI fields in `lib/env.ts` are consumed only by the chat route branches being removed. Delete `MINIMAX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_API_ENDPOINT`, and `OPENAI_MODEL` from `envSchema` so malformed alternate-provider values cannot make `getEnv()` fail or otherwise influence chat runtime; Zod's default object behavior will ignore those ambient variables.

### Step 5: Strengthen prompt and deterministic output enforcement

In `lib/conversation/system-prompt.ts`, replace the current commitment hard rule with:

```ts
- Never provide legal advice or interpret NDA, liability, or contract terms.
- Never commit Balance Studio or its producers to specific pricing, guaranteed timelines or delivery dates, crew or studio availability, or contract terms. State that these require producer review.
```

In `lib/conversation/reply-sanitize.ts`, preserve prompt-injection and out-of-scope rules, but add output-specific producer boundaries before the generic patterns:

```ts
const PRODUCER_BOUNDARY_PATTERNS: Array<{ pattern: RegExp; response: string }> = [
  {
    pattern: /\b(?:legally (?:binding|enforceable)|legal advice|you should sign|contract (?:is|means|allows|requires)|nda (?:is|means|allows|requires))\b/i,
    response: "I can't provide legal or contract advice. A Balance producer must review legal and contract terms directly."
  },
  {
    pattern: /\b(?:final |fixed |guaranteed )?(?:price|pricing|quote|fee|cost)\b[^.\n]*(?:\$|sgd|usd|eur|gbp|\d[\d,]*(?:\.\d{2})?)/i,
    response: 'Final pricing is set by Balance producers after they review the scope.'
  },
  {
    pattern: /\b(?:guarantee|guaranteed|promise|promised|definitely)\b[^.\n]*(?:deliver|delivery|complete|completed|ready|timeline|date|by\b)/i,
    response: 'Final timing is confirmed by Balance producers after they review scope and scheduling.'
  },
  {
    pattern: /\b(?:crew|team|studio|we) (?:is|are|will be) (?:definitely )?(?:available|free|booked|confirmed)\b/i,
    response: 'Availability is confirmed by Balance producers after they review the project and schedule.'
  }
];
```

At the start of `matchesRefusal`, scan `PRODUCER_BOUNDARY_PATTERNS` against `reply` before the existing user/reply refusal loops:

```ts
for (const { pattern, response } of PRODUCER_BOUNDARY_PATTERNS) {
  if (pattern.test(reply)) return response;
}
```

Keep `sanitizeReply`'s existing early return exactly as the second boundary:

```ts
if (refusal) return { reply: refusal, draft: {}, overridden: true };
```

This guarantees associated prose-draft and tool-call updates are discarded whenever provider output is overridden.

### Step 6: Add provider governance and align notice copy

Create `docs/ai-provider-governance.md` with this complete operational contract:

```md
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
```

Keep `lib/privacy/notice.ts` naming DeepSeek and the human-only path. Only adjust copy if needed for exact alignment; do not bump `CONSENT_VERSION` merely for wording that already communicates the same processing boundary.

Run a factual governance check:

```powershell
rg -n "DeepSeek only|api\.deepseek\.com|must not send|4,000|TXT and PDF|human-only" docs/ai-provider-governance.md
```

Expected: each required governance statement is present; no MiniMax/OpenAI fallback is described as permitted.

### Step 7: Run focused tests to verify GREEN

Run:

```powershell
npx vitest run tests/api/chat-route.test.ts tests/conversation/system-prompt.test.ts tests/conversation/reply-sanitize.test.ts tests/widget/data-use-notice.test.tsx
```

Expected GREEN: DeepSeek endpoint/model assertions pass, alternate credentials do not cause a call, provider failures are stable/redacted, deterministic local routes still work, and all prohibited provider outputs return empty draft updates.

### Step 8: Check and commit provider/output governance

Run:

```powershell
git diff --check
git add -- app/api/chat/route.ts lib/env.ts lib/conversation/system-prompt.ts lib/conversation/reply-sanitize.ts lib/privacy/notice.ts docs/ai-provider-governance.md tests/api/chat-route.test.ts tests/conversation/system-prompt.test.ts tests/conversation/reply-sanitize.test.ts tests/widget/data-use-notice.test.tsx
git commit --message "fix: pin governed AI processing to DeepSeek"
```

If `lib/privacy/notice.ts` required no change, omit it from `git add`. Expected: one commit for provider selection, governance/disclosure, prompt boundaries, sanitizer boundaries, and their tests.

## Task 4: Attachment Preselection Guard And Factual Disclosure

**Files:**
- Modify: `lib/uploads/quarantine.ts:3-15,67-117`
- Modify: `components/widget/attachment-dropzone.tsx:1-13,34-46,150-201,203-337`
- Modify: `components/widget/widget-overlay.tsx:1493-1498`
- Modify: `tests/uploads/quarantine.test.ts`
- Modify: `tests/widget/attachment-dropzone.test.tsx`

### Step 1: Add failing policy-source and dropzone tests

First extend `tests/uploads/quarantine.test.ts` so the disclosure can consume exported runtime facts rather than duplicate private literals:

```ts
import {
  PRIVATE_ANALYSIS_UPLOAD_POLICY,
  validateFile,
  validateFileBatch
} from '@/lib/uploads/quarantine';

test('exports the exact private AI analysis formats and limits', () => {
  expect(PRIVATE_ANALYSIS_UPLOAD_POLICY).toEqual({
    acceptedFormats: ['PNG', 'JPEG', 'GIF', 'WebP', 'PDF', 'TXT', 'CSV'],
    accept: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv',
    maxFiles: 5,
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxTotalSizeBytes: 25 * 1024 * 1024,
    maxExtractedCharacters: 4000
  });
});
```

In `tests/widget/attachment-dropzone.test.tsx`, use this availability helper so each guard test can distinguish the initial GET from prohibited POST processing:

```ts
function mockPrivateStorageAvailable() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/telegram/upload') && !init?.method) {
      return new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected processing request: ${String(input)}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}
```

Add these complete component tests:

```tsx
test('discloses the exact AI formats, limits, extraction behavior, and DeepSeek flow before selection', async () => {
  mockPrivateStorageAvailable();
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());

  const disclosure = screen.getByTestId('private-analysis-upload-disclosure');
  expect(disclosure).toHaveTextContent(/PNG, JPEG, GIF, WebP, PDF, TXT, and CSV/i);
  expect(disclosure).toHaveTextContent(/up to 5 files/i);
  expect(disclosure).toHaveTextContent(/10 MB each/i);
  expect(disclosure).toHaveTextContent(/25 MB total/i);
  expect(disclosure).toHaveTextContent(/TXT and PDF.*up to 4,000 characters/i);
  expect(disclosure).toHaveTextContent(/images and CSV may yield no extracted text/i);
  expect(disclosure).toHaveTextContent(/extracted text.*DeepSeek/i);
  expect(disclosure).toHaveTextContent(/does not prove.*non-confidential/i);
  expect(container.querySelector('input[type="file"]')).toHaveAttribute(
    'accept',
    'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv'
  );
});

test('does not open the selector when current message context is confidential', async () => {
  mockPrivateStorageAvailable();
  const { container } = render(
    <AttachmentDropzone
      onAddLink={vi.fn()}
      onAddFile={vi.fn()}
      messageContext="The attached brief contains confidential information"
    />
  );
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  await waitFor(() => expect(fileInput).not.toBeDisabled());
  const clickSpy = vi.spyOn(fileInput, 'click');

  fireEvent.click(screen.getByRole('button', { name: /store file privately/i }));

  expect(clickSpy).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/cannot process confidential or sensitive material/i);
  expect(screen.getByRole('alert').textContent).not.toContain('attached brief');
});

test('blocks a confidential filename before consent persistence, byte reads, upload, or callbacks', async () => {
  const fetchMock = mockPrivateStorageAvailable();
  const onAddFile = vi.fn();
  const onFileAnalyzed = vi.fn();
  const { container } = render(
    <AttachmentDropzone
      onAddLink={vi.fn()}
      onAddFile={onAddFile}
      onFileAnalyzed={onFileAnalyzed}
      sessionId="sess-guard"
    />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  enableAnalysisConsent();

  const file = new File(['do not read'], 'confidential-client-brief.txt', { type: 'text/plain' });
  const arrayBufferSpy = vi.fn(async () => new ArrayBuffer(0));
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBufferSpy });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cannot process confidential/i));
  expect(input.value).toBe('');
  expect(arrayBufferSpy).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toEqual([]);
  expect(onAddFile).not.toHaveBeenCalled();
  expect(onFileAnalyzed).not.toHaveBeenCalled();
});

test('allows a benign filename containing a near-match', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    if (String(input).includes('/consent')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, analyses: [{ extractedText: 'ordinary text' }] }), { status: 200 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} sessionId="sess-safe" />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  enableAnalysisConsent();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['hello'], 'personal-project.txt', { type: 'text/plain' })] }
  });

  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
});
```

The filename test proves the client does not persist consent or initiate server extraction/storage/upload because no POST is made. Byte validation cannot run because `arrayBuffer()` is never called. No filename or matched phrase should be logged or shown in the diversion.

### Step 2: Run attachment tests to verify RED

Run:

```powershell
npx vitest run tests/uploads/quarantine.test.ts tests/widget/attachment-dropzone.test.tsx
```

Expected RED: the policy object is not exported, the dropzone lacks `messageContext`, the selector opens for matching context, matching filenames reach consent/byte processing, and factual disclosure/`accept` are absent.

### Step 3: Export the active AI analysis policy

At the top of `lib/uploads/quarantine.ts`, replace private limit literals with one exported source of truth:

```ts
export const PRIVATE_ANALYSIS_UPLOAD_POLICY = {
  acceptedFormats: ['PNG', 'JPEG', 'GIF', 'WebP', 'PDF', 'TXT', 'CSV'],
  accept: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv',
  maxFiles: 5,
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxTotalSizeBytes: 25 * 1024 * 1024,
  maxExtractedCharacters: 4000
} as const;

const {
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  maxTotalSizeBytes: MAX_TOTAL_SIZE_BYTES,
  maxFiles: MAX_FILES
} = PRIVATE_ANALYSIS_UPLOAD_POLICY;
```

Keep `ALLOWED_MIMES` exactly aligned with `accept`. Do not expand it to dormant DOCX/PPTX extractors or the separate human relay formats.

### Step 4: Guard selector opening and filename handling before processing

In `components/widget/attachment-dropzone.tsx`, import the classifier, stable copy, and policy:

```ts
import {
  classifyConfidentialIntent,
  CONFIDENTIAL_INTAKE_RESPONSE
} from '@/lib/privacy/confidential-intent';
import {
  PRIVATE_ANALYSIS_UPLOAD_POLICY,
  validateFile,
  validateFileBatch
} from '@/lib/uploads/quarantine';
```

Add the optional current composer context to the component contract:

```ts
export function AttachmentDropzone({
  onAddLink,
  onAddFile,
  onFileAnalyzed,
  sessionId,
  consent,
  messageContext = ''
}: {
  onAddLink: (link: ReferenceLink) => void;
  onAddFile: (file: ReferenceFile) => void;
  onFileAnalyzed?: (fileName: string, extractedText: string) => void;
  sessionId?: string | null;
  consent?: AttachmentConsent | null;
  messageContext?: string;
}) {
```

Add a fail-closed helper that never exposes classification details:

```ts
function shouldDivert(value: string): boolean {
  try {
    return classifyConfidentialIntent(value) !== 'allow';
  } catch {
    return true;
  }
}

function openFileSelector() {
  if (shouldDivert(messageContext)) {
    setError(CONFIDENTIAL_INTAKE_RESPONSE);
    return;
  }
  setError(null);
  fileInputRef.current?.click();
}
```

Change `handleFiles` to receive the input element so a blocked selection is cleared immediately. The filename loop must be the first operation after checking that files exist:

```ts
async function handleFiles(input: HTMLInputElement) {
  const files = input.files;
  if (!files) return;

  const fileArray = Array.from(files);
  if (fileArray.some((file) => shouldDivert(file.name))) {
    input.value = '';
    setError(CONFIDENTIAL_INTAKE_RESPONSE);
    return;
  }

  const consentToUse = effectiveConsent ?? null;
  if (!hasAnalysisConsent(consentToUse)) {
    setError('Please confirm that Balance Assist may analyse these files before uploading.');
    return;
  }
  if (!consentToUse) {
    setError('Consent details are missing. Please re-confirm your upload permissions.');
    return;
  }
  if (!await persistConsent('analysis')) return;

  const buffers = await Promise.all(fileArray.map((file) => readFileBuffer(file)));
  const batchResult = validateFileBatch(fileArray.map((file, index) => ({ file, buffer: buffers[index] })));
  if (!batchResult.ok) {
    setError(batchResult.reason ?? 'Files failed validation.');
    return;
  }
  for (const [index, file] of fileArray.entries()) {
    const validation = validateFile(file, buffers[index]);
    if (!validation.ok) {
      setError(validation.reason);
      return;
    }
  }

  // Keep the existing queue, FormData, private upload, server-analysis callback,
  // and status code below this point unchanged.
}
```

The current component imports `validateFile` but does not call it in `handleFiles`; the explicit loop above makes per-file client validation truthful while preserving server authority.

Update the selector controls:

```tsx
<button
  type="button"
  aria-describedby="private-analysis-upload-disclosure"
  disabled={!privateStorageAvailable}
  onClick={openFileSelector}
  // preserve existing styles
>
```

```tsx
<input
  id="attachment-drop"
  ref={fileInputRef}
  type="file"
  multiple
  accept={PRIVATE_ANALYSIS_UPLOAD_POLICY.accept}
  disabled={!privateStorageAvailable}
  onChange={(event) => { void handleFiles(event.currentTarget); }}
  tabIndex={-1}
  aria-hidden="true"
  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
/>
```

### Step 5: Add truthful disclosure before the selector and wire current context

Replace the current short private-storage copy in `AttachmentDropzone` with a visible block before the selector button:

```tsx
<div
  id="private-analysis-upload-disclosure"
  data-testid="private-analysis-upload-disclosure"
  style={{ fontSize: 11, color: brandTokens.colors.mutedText, lineHeight: 1.5 }}
>
  Use non-confidential files only. Accepted: PNG, JPEG, GIF, WebP, PDF, TXT, and CSV;
  up to 5 files, 10 MB each, and 25 MB total. Files are validated and stored privately
  for the temporary retention period. TXT and PDF may yield up to 4,000 characters of
  server-extracted text; accepted images and CSV may yield no extracted text. Any
  extracted text used in AI mode is processed by DeepSeek. Consent, filename checks,
  private storage, and extraction do not prove a file is non-confidential. Use the
  human-only path for protected material.
</div>
```

Do not say files are "never sent to the team" as the entire disclosure: the relevant Task 5 fact is that extracted text can be sent to DeepSeek in AI mode. It is fine to retain a separate accurate statement that private AI-analysis files are not producer-transferred without approval.

In `components/widget/widget-overlay.tsx:1493-1498`, wire only the available current composer text:

```tsx
<AttachmentDropzone
  onAddLink={appendReferenceLink}
  onAddFile={appendReferenceFile}
  onFileAnalyzed={handleFileAnalyzed}
  sessionId={sessionId}
  messageContext={inputValue}
/>
```

Do not pass message history or draft data. Do not add this guard to the human relay file request path; human mode is the destination for protected material.

### Step 6: Run attachment tests to verify GREEN

Run:

```powershell
npx vitest run tests/privacy/confidential-intent.test.ts tests/uploads/quarantine.test.ts tests/widget/attachment-dropzone.test.tsx
```

Expected GREEN: disclosure matches exported runtime limits, current-message intent prevents `.click()`, matching filename clears the input before consent/bytes/network/callbacks, and benign near-matches still upload.

### Step 7: Check and commit attachment safeguards

Run:

```powershell
git diff --check
git add -- lib/uploads/quarantine.ts components/widget/attachment-dropzone.tsx components/widget/widget-overlay.tsx tests/uploads/quarantine.test.ts tests/widget/attachment-dropzone.test.tsx
git commit --message "feat: guard private AI attachments before selection"
```

Expected: one commit containing the AI attachment policy/disclosure/guard and tests; no changes to `lib/uploads/file-policy.ts` or the human relay upload handler.

## Task 5: Full Verification

**Files:**
- Verify only; do not create a cleanup commit unless a verification failure requires a code/test correction.

### Step 1: Run the complete Task 5 regression set

Run:

```powershell
npx vitest run tests/privacy/confidential-intent.test.ts tests/api/chat-auth-order.test.ts tests/api/chat-route.test.ts tests/conversation/system-prompt.test.ts tests/conversation/reply-sanitize.test.ts tests/widget/data-use-notice.test.tsx tests/uploads/quarantine.test.ts tests/uploads/extract-text.test.ts tests/widget/attachment-dropzone.test.tsx
```

Expected GREEN: all listed files pass. Confirm the route-order tests prove auth/origin/schema/session validation precedes classification, and guard tests prove no provider/draft/event/content-log activity occurs on diversion.

### Step 2: Run the full unit/integration suite

Run:

```powershell
npm test
```

Expected GREEN: Vitest exits 0 with no failed test files. Database-dependent tests may skip only when they already use the repository's documented environment skip; no new Task 5 test may be skipped.

### Step 3: Run static verification and production build

Run:

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

Expected GREEN:

- ESLint exits 0 with zero warnings;
- TypeScript exits 0;
- Next.js production build completes successfully.

### Step 4: Verify provider and privacy invariants directly

Run:

```powershell
rg -n "api\.minimax\.chat|api\.openai\.com|OPENAI_API_ENDPOINT|callMinimax|readMinimaxContent" app/api/chat/route.ts
rg -n "api\.deepseek\.com/v1/chat/completions|DEEPSEEK_MODEL|chat_provider_unavailable" app/api/chat/route.ts
rg -n "console\.(log|warn|error)|logger\.(info|warn|error)|emitEvent" lib/privacy/confidential-intent.ts components/widget/attachment-dropzone.tsx
rg -n "DeepSeek only|human-only|4,000|TXT and PDF" docs/ai-provider-governance.md
git diff --check
```

Expected:

- first `rg` returns no matches in the chat route;
- second `rg` finds the fixed DeepSeek endpoint, configured model, and stable unavailable code;
- third `rg` returns no classifier/dropzone content logging or event emission;
- fourth `rg` finds all governance anchors;
- `git diff --check` exits 0.

### Step 5: Inspect commit scope and final worktree

Run:

```powershell
git status --short
git log --oneline -5
git diff HEAD~4..HEAD --stat
```

Expected:

- worktree is clean;
- the four implementation commits are visible in order;
- changed files are limited to the classifier/tests, chat route/tests, governance/prompt/sanitizer/notice/tests, and AI attachment policy/UI/tests listed above.

If verification required a correction, rerun the smallest failing command first, then all commands in Steps 1-4, and commit only the correction with a focused message such as:

```powershell
git add <only-the-corrected-files>
git commit --message "test: close confidential intake regression"
```

Do not squash or amend unless explicitly requested.
