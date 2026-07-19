import { createHash, randomBytes, randomUUID } from 'node:crypto';

import schema from '../../config/monday-crm-schema.json';
import { createServerSupabaseClient, type SupabaseServerClient } from '../supabase/server';
import { decryptMondaySecret, encryptMondaySecret } from './oauth-crypto';

const AUTHORIZE_ENDPOINT = 'https://auth.monday.com/oauth2/authorize';
const TOKEN_ENDPOINT = 'https://auth.monday.com/oauth_ms/oauth/token';
const REVOCATION_ENDPOINT = 'https://auth.monday.com/oauth_ms/oauth/revoke';
const API_ENDPOINT = 'https://api.monday.com/v2';
const REQUIRED_SCOPES = ['me:read', 'account:read', 'boards:read', 'boards:write'] as const;
const ACCESS_AAD = 'monday:oauth:connection:access';
const REFRESH_AAD = 'monday:oauth:connection:refresh';
const EXPIRY_SKEW_MS = 60_000;

type Environment = Record<string, string | undefined>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type OAuthDependencies = {
  environment?: Environment;
  fetchImpl?: FetchLike;
  supabase?: SupabaseServerClient;
  now?: () => Date;
};

type ConnectionRow = {
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  access_expires_at: string;
  scopes: string[];
  token_version: number;
};

type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

export class MondayOAuthError extends Error {
  constructor(public readonly retryable = false) {
    super('Monday OAuth operation failed');
    this.name = 'MondayOAuthError';
  }
}

function oauthConfig(environment: Environment) {
  const clientId = environment.MONDAY_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.MONDAY_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = environment.MONDAY_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) throw new MondayOAuthError();
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') throw new Error('insecure redirect');
  } catch {
    throw new MondayOAuthError();
  }
  return { clientId, clientSecret, redirectUri };
}

function serviceClient(dependencies: OAuthDependencies) {
  const client = dependencies.supabase ?? createServerSupabaseClient();
  if (!client) throw new MondayOAuthError(true);
  return client;
}

function base64Url(value: Buffer) {
  return value.toString('base64url');
}

function stateHash(state: string) {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

function verifierAad(hash: string) {
  return `monday:oauth:attempt:${hash}`;
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 16_384 && !/[\s\0]/.test(value);
}

function parseScopes(value: unknown) {
  const scopes = typeof value === 'string' ? value.split(/[\s,]+/).filter(Boolean) : [];
  if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) throw new MondayOAuthError();
  return [...new Set(scopes)].sort();
}

function accessTokenExpiry(accessToken: string, now: Date) {
  const parts = accessToken.split('.');
  if (parts.length !== 3) throw new MondayOAuthError();
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const exp = payload && typeof payload === 'object' ? Number((payload as { exp?: unknown }).exp) : NaN;
    const expiresAt = new Date(exp * 1000);
    if (!Number.isSafeInteger(exp) || expiresAt.getTime() <= now.getTime() + 60_000
      || expiresAt.getTime() > now.getTime() + 183 * 24 * 60 * 60_000) {
      throw new MondayOAuthError();
    }
    return expiresAt;
  } catch (error) {
    if (error instanceof MondayOAuthError) throw error;
    throw new MondayOAuthError();
  }
}

async function exchangeToken(
  parameters: Record<string, string>,
  dependencies: OAuthDependencies,
  fallbackScopes?: string[],
): Promise<TokenSet> {
  const environment = dependencies.environment ?? process.env;
  const config = oauthConfig(environment);
  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: parameters.grant_type,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...parameters,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MondayOAuthError(true);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object') throw new MondayOAuthError(response.status >= 500 || response.status === 429);
  const token = body as Record<string, unknown>;
  if (String(token.token_type).toLowerCase() !== 'bearer' || !validToken(token.access_token) || !validToken(token.refresh_token)) {
    throw new MondayOAuthError();
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: accessTokenExpiry(token.access_token, dependencies.now?.() ?? new Date()),
    scopes: parseScopes(token.scope ?? fallbackScopes?.join(' ')),
  };
}

async function attestConnection(accessToken: string, dependencies: OAuthDependencies) {
  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(API_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: accessToken, 'API-Version': '2026-07', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query OAuthAttestation($boardIds: [ID!]) { me { kind account { id } } boards(ids: $boardIds) { id access_level } }',
        variables: { boardIds: [schema.boardId] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MondayOAuthError(true);
  }
  const body: unknown = await response.json().catch(() => null);
  const data = body && typeof body === 'object' ? (body as { data?: unknown; errors?: unknown }).data : null;
  const me = data && typeof data === 'object' ? (data as { me?: { kind?: unknown; account?: { id?: unknown } } }).me : null;
  const accountId = me?.account?.id;
  const boards = data && typeof data === 'object' ? (data as { boards?: unknown }).boards : null;
  if (!response.ok || Array.isArray((body as { errors?: unknown } | null)?.errors) || me?.kind !== 'admin'
    || accountId !== schema.accountId || !Array.isArray(boards) || boards.length !== 1
    || (boards[0] as { id?: unknown; access_level?: unknown })?.id !== schema.boardId
    || (boards[0] as { access_level?: unknown }).access_level !== 'edit') {
    throw new MondayOAuthError();
  }
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data && typeof data === 'object' ? data as T : null;
}

export async function createMondayOAuthAttempt(dependencies: OAuthDependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const config = oauthConfig(environment);
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(64));
  const hash = stateHash(state);
  const challenge = base64Url(createHash('sha256').update(verifier, 'ascii').digest());
  const expiresAt = new Date((dependencies.now?.() ?? new Date()).getTime() + 10 * 60_000).toISOString();
  const { error } = await serviceClient(dependencies).from('monday_oauth_attempts').insert({
    state_hash: hash,
    encrypted_code_verifier: encryptMondaySecret(verifier, verifierAad(hash), environment),
    redirect_uri: config.redirectUri,
    expires_at: expiresAt,
  });
  if (error) throw new MondayOAuthError(true);

  const authorizeUrl = new URL(AUTHORIZE_ENDPOINT);
  authorizeUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return authorizeUrl.toString();
}

export async function completeMondayOAuthCallback(code: string, state: string, status: string, dependencies: OAuthDependencies = {}) {
  if (status !== 'success') throw new MondayOAuthError();
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new MondayOAuthError();
  const environment = dependencies.environment ?? process.env;
  const hash = stateHash(state);
  const { data, error } = await serviceClient(dependencies).rpc('consume_monday_oauth_attempt', { p_state_hash: hash });
  const attempt = firstRow<{ encrypted_code_verifier?: unknown; redirect_uri?: unknown }>(data);
  if (error || typeof attempt?.encrypted_code_verifier !== 'string' || attempt.redirect_uri !== oauthConfig(environment).redirectUri) throw new MondayOAuthError();
  if (!validToken(code)) throw new MondayOAuthError();
  const verifier = decryptMondaySecret(attempt.encrypted_code_verifier, verifierAad(hash), environment);
  const tokens = await exchangeToken({
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: oauthConfig(environment).redirectUri,
  }, dependencies);
  await attestConnection(tokens.accessToken, dependencies);
  const { error: installError } = await serviceClient(dependencies).rpc('install_monday_oauth_connection', {
    p_encrypted_access_token: encryptMondaySecret(tokens.accessToken, ACCESS_AAD, environment),
    p_encrypted_refresh_token: encryptMondaySecret(tokens.refreshToken, REFRESH_AAD, environment),
    p_access_expires_at: tokens.expiresAt.toISOString(),
    p_scopes: tokens.scopes,
    p_account_id: schema.accountId,
    p_board_id: schema.boardId,
  });
  if (installError) throw new MondayOAuthError(true);
}

async function readConnection(client: SupabaseServerClient) {
  const { data, error } = await client.from('monday_oauth_connection')
    .select('encrypted_access_token,encrypted_refresh_token,access_expires_at,scopes,token_version')
    .eq('singleton', true)
    .maybeSingle();
  if (error || !data) throw new MondayOAuthError(true);
  return data as ConnectionRow;
}

async function resolveAccessToken(dependencies: OAuthDependencies, forceRefresh: boolean) {
  const environment = dependencies.environment ?? process.env;
  const client = serviceClient(dependencies);
  const now = dependencies.now?.() ?? new Date();
  const connection = await readConnection(client);
  if (!forceRefresh && new Date(connection.access_expires_at).getTime() > now.getTime() + EXPIRY_SKEW_MS) {
    return decryptMondaySecret(connection.encrypted_access_token, ACCESS_AAD, environment);
  }

  const owner = randomUUID();
  const { data, error } = await client.rpc('acquire_monday_oauth_refresh_lease', { p_owner: owner, p_lease_seconds: 60 });
  const lease = firstRow<{ acquired?: unknown; encrypted_refresh_token?: unknown; token_version?: unknown }>(data);
  if (error) throw new MondayOAuthError(true);
  if (lease?.acquired !== true || typeof lease.encrypted_refresh_token !== 'string' || typeof lease.token_version !== 'number') {
    throw new MondayOAuthError(true);
  }

  const refreshToken = decryptMondaySecret(lease.encrypted_refresh_token, REFRESH_AAD, environment);
  const tokens = await exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken }, dependencies, connection.scopes);
  const expiresAt = tokens.expiresAt.toISOString();
  const rotation = {
    p_owner: owner,
    p_expected_version: lease.token_version,
    p_encrypted_access_token: encryptMondaySecret(tokens.accessToken, ACCESS_AAD, environment),
    p_encrypted_refresh_token: encryptMondaySecret(tokens.refreshToken, REFRESH_AAD, environment),
    p_access_expires_at: expiresAt,
    p_scopes: tokens.scopes,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: rotated, error: rotateError } = await client.rpc('rotate_monday_oauth_tokens', rotation);
    if (!rotateError && rotated === true) return tokens.accessToken;
    if (!rotateError) break;
  }

  // A lost database response may hide a successful rotation; reconcile before requiring reauthorization.
  const current = await readConnection(client);
  if (current.token_version > lease.token_version
    && decryptMondaySecret(current.encrypted_access_token, ACCESS_AAD, environment) === tokens.accessToken) {
    return tokens.accessToken;
  }
  throw new MondayOAuthError(true);
}

export function resolveMondayAccessToken(dependencies: OAuthDependencies = {}) {
  return resolveAccessToken(dependencies, false);
}

export function refreshMondayAccessToken(dependencies: OAuthDependencies = {}) {
  return resolveAccessToken(dependencies, true);
}

async function revokeToken(token: string, tokenType: 'access_token' | 'refresh_token', dependencies: OAuthDependencies) {
  const environment = dependencies.environment ?? process.env;
  const config = oauthConfig(environment);
  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(REVOCATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        token,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        token_type_hint: tokenType,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MondayOAuthError(true);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object' || (body as { success?: unknown }).success !== true) {
    throw new MondayOAuthError(response.status >= 500 || response.status === 429);
  }
}

export async function disconnectMondayOAuthConnection(dependencies: OAuthDependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const client = serviceClient(dependencies);
  const owner = randomUUID();
  const { data, error } = await client.rpc('acquire_monday_oauth_refresh_lease', { p_owner: owner, p_lease_seconds: 60 });
  const lease = firstRow<{ acquired?: unknown; encrypted_refresh_token?: unknown; token_version?: unknown }>(data);
  if (error || lease?.acquired !== true || typeof lease.encrypted_refresh_token !== 'string'
    || typeof lease.token_version !== 'number') {
    throw new MondayOAuthError(true);
  }
  const connection = await readConnection(client);
  if (connection.token_version !== lease.token_version) throw new MondayOAuthError(true);

  const accessToken = decryptMondaySecret(connection.encrypted_access_token, ACCESS_AAD, environment);
  const refreshToken = decryptMondaySecret(lease.encrypted_refresh_token, REFRESH_AAD, environment);
  await revokeToken(accessToken, 'access_token', dependencies);
  await revokeToken(refreshToken, 'refresh_token', dependencies);

  const { data: disconnected, error: disconnectError } = await client.rpc('disconnect_monday_oauth_connection', {
    p_owner: owner,
    p_expected_version: lease.token_version,
  });
  if (disconnectError || disconnected !== true) throw new MondayOAuthError(true);
}
