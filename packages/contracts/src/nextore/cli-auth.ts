/** NXD-P10 CLI authorization DTOs (shared by daemon, web, and od CLI). */

export type NextoreApiTokenScope = 'project:read' | 'project:write' | 'run:create';

/** POST /api/auth/cli/session request (browser, session-authenticated). */
export interface NextoreCliCodeRequest {
  /** PKCE S256 challenge: base64url(sha256(verifier)). */
  challenge: string;
  /** Opaque CSRF state echoed back through the loopback redirect. */
  state: string;
}

/** POST /api/auth/cli/session response. */
export interface NextoreCliCodeResponse {
  code: string;
  expiresAt: number;
}

/** POST /api/auth/cli/token request (no session). */
export interface NextoreCliTokenRequest {
  code: string;
  verifier: string;
  state: string;
  label?: string;
}

/** POST /api/auth/cli/token response. The raw token is shown exactly once. */
export interface NextoreCliTokenResponse {
  token: string;
  tokenId: string;
  memberId: number;
  scopes: NextoreApiTokenScope[];
  expiresAt: number;
}

/** One stored CLI token as listed for its owner. */
export interface NextoreCliTokenSummary {
  id: string;
  memberId: number;
  scopes: NextoreApiTokenScope[];
  label: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}
