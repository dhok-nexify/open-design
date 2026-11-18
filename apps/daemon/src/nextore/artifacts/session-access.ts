import type { NextoreConfig } from '../config.js';
import {
  isPermanentTokenFailure,
  refreshAccessToken,
  type TokenSet,
} from '../auth/oauth.js';
import type { NextoreSession, NextoreSessionStore } from '../auth/session-store.js';

/** Refresh a little before the actual expiry so an upload never starts with a dying token. */
const REFRESH_SKEW_MS = 60_000;

export interface SessionAccessDeps {
  store: NextoreSessionStore;
  config: NextoreConfig;
  now?: () => number;
  /** Test seam; production uses refreshAccessToken. */
  refresh?: (config: NextoreConfig, refreshToken: string) => Promise<TokenSet>;
  /** Test seam; production uses isPermanentTokenFailure. */
  isPermanentFailure?: (error: unknown) => boolean;
  /** Optional revocation check supplied by the caller (for example a worker pause set). */
  isRevoked?: (sid: string) => boolean;
}

const refreshes = new Map<string, Promise<NextoreSession | null>>();

function isUsable(session: NextoreSession, now: number): boolean {
  return session.tokenExpiresAt == null || session.tokenExpiresAt - now > REFRESH_SKEW_MS;
}

async function renewOnce(session: NextoreSession, deps: SessionAccessDeps): Promise<NextoreSession | null> {
  const now = deps.now ?? Date.now;
  const current = deps.store.find(session.sid);
  if (!current) return null;
  if (deps.isRevoked?.(current.sid)) return null;

  // Another request may have rotated the token while this caller loaded its row.
  if (current.accessToken !== session.accessToken) return current;
  if (!current.refreshToken) {
    deps.store.remove(current.sid);
    return null;
  }

  try {
    const refresh = deps.refresh ?? refreshAccessToken;
    const tokens = await refresh(deps.config, current.refreshToken);
    const at = now();
    const refreshToken = tokens.refreshToken ?? current.refreshToken;
    deps.store.updateTokens(current.sid, {
      accessToken: tokens.accessToken,
      refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      validatedAt: at,
    });
    return {
      ...current,
      accessToken: tokens.accessToken,
      refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      lastSeenAt: at,
      lastValidatedAt: at,
    };
  } catch (error) {
    if ((deps.isPermanentFailure ?? isPermanentTokenFailure)(error)) {
      deps.store.remove(current.sid);
      return null;
    }
    return null;
  }
}

function renew(session: NextoreSession, deps: SessionAccessDeps): Promise<NextoreSession | null> {
  const inFlight = refreshes.get(session.sid);
  if (inFlight) return inFlight;

  const pending = renewOnce(session, deps);
  refreshes.set(session.sid, pending);
  const release = () => {
    if (refreshes.get(session.sid) === pending) refreshes.delete(session.sid);
  };
  void pending.then(release, release);
  return pending;
}

/**
 * Resolve a still-valid access token for one member, refreshing it when needed.
 *
 * The worker must publish as the run initiator, never as a shared service account. A missing or
 * revoked session therefore yields null and the caller keeps the queue item in `publish_pending`.
 */
export async function resolveMemberAccessToken(
  memberId: number,
  deps: SessionAccessDeps,
): Promise<string | null> {
  if (!Number.isInteger(memberId) || memberId <= 0) return null;
  const now = deps.now ?? Date.now;
  const sessions = deps.store
    .listByMember(memberId)
    .filter((session) => !deps.isRevoked?.(session.sid))
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt);

  for (const session of sessions) {
    if (isUsable(session, now())) return session.accessToken;
    const renewed = await renew(session, deps);
    if (renewed && isUsable(renewed, now())) return renewed.accessToken;
  }
  return null;
}
