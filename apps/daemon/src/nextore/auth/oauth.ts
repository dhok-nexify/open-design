import type { NextoreConfig } from '../config.js';

/**
 * The token endpoint of the site's OAuthServerModule (RFC 6749 §4.1.3 / §6).
 *
 * These are public clients: no client secret is sent, and none is stored. PKCE
 * plus the exact redirect_uri are what bind a code to this daemon.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute epoch milliseconds, or null when the site's API-key policy sets no expiry. */
  expiresAt: number | null;
  scope: string;
}

export class NextoreOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = 'NextoreOAuthError';
  }
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const TOKEN_TIMEOUT_MS = 15_000;

function tokenEndpoint(config: NextoreConfig): string {
  return new URL('/oauth/token', config.baseUrl).toString();
}

export function callbackUrl(config: NextoreConfig): string {
  return `${config.designerBaseUrl}/auth/callback`;
}

function positiveSeconds(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function toTokenSet(payload: TokenResponse, now: number): TokenSet {
  if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new NextoreOAuthError('invalid_response', 'The token endpoint returned no access_token.');
  }

  const expiresIn = positiveSeconds(payload.expires_in);

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token
      ? payload.refresh_token
      : null,
    expiresAt: expiresIn === null ? null : now + expiresIn * 1000,
    scope: typeof payload.scope === 'string' ? payload.scope : '',
  };
}

async function postToken(config: NextoreConfig, form: Record<string, string>): Promise<TokenSet> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);

  let response: Response;
  let text: string;
  try {
    response = await fetch(tokenEndpoint(config), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    // Read the body while the timeout is still armed: a server that sends
    // headers and then stalls must not hold the sign-in request open forever.
    text = await response.text();
  } catch (error) {
    throw new NextoreOAuthError(
      'token_endpoint_unreachable',
      controller.signal.aborted
        ? `The token endpoint did not answer within ${TOKEN_TIMEOUT_MS}ms.`
        : `The token endpoint is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
  let payload: TokenResponse;
  try {
    payload = text ? (JSON.parse(text) as TokenResponse) : {};
  } catch {
    throw new NextoreOAuthError(
      'invalid_response',
      `The token endpoint returned non-JSON (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : 'token_request_failed';
    const description = typeof payload.error_description === 'string'
      ? payload.error_description
      : `HTTP ${response.status}`;
    throw new NextoreOAuthError(code, description, response.status);
  }

  return toTokenSet(payload, Date.now());
}

/** Redeem an approval code. The redirect_uri must be the one the authorize request carried. */
export function exchangeAuthorizationCode(
  config: NextoreConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenSet> {
  return postToken(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(config),
    client_id: config.oauthClientId,
    code_verifier: codeVerifier,
  });
}

/**
 * Renew a connection. The module rotates the refresh token and deletes the
 * previous NexTore API session, so the returned set replaces the stored one
 * wholesale; there is no "old token still works" grace period.
 */
export function refreshAccessToken(
  config: NextoreConfig,
  refreshToken: string,
): Promise<TokenSet> {
  return postToken(config, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.oauthClientId,
  });
}

/**
 * Whether a refresh failure means the stored connection is dead.
 *
 * A 400/401/403 from the module is an OAuth refusal (invalid_grant, an unknown
 * client, a revoked connection) and reusing the refresh token cannot recover.
 * Network errors, timeouts, 408 and 429 are transient and must leave the
 * session row intact so the next request can retry.
 */
export function isPermanentTokenFailure(error: unknown): boolean {
  if (!(error instanceof NextoreOAuthError) || error.statusCode === null) return false;
  return error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403;
}
