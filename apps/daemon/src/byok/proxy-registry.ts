import { randomBytes } from 'node:crypto';

/**
 * Per-run capability tokens for the BYOK proxy (NXD-P01, path A).
 *
 * The sandbox has no route to the internet. The agent's provider base URL is
 * rewritten to a daemon endpoint carrying one of these tokens, and the route
 * forwards only to the upstream that token was issued for. The token is the
 * credential: it is unguessable, short-lived, bound to one run, and worthless
 * against any other destination - so the proxy can never be used as a general
 * fetcher.
 */
export interface ByokProxyTarget {
  baseUrl: string;
  runId: string | null;
  memberId: number | null;
  expiresAt: number;
}

export const BYOK_PROXY_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export interface ByokProxyRegistry {
  issue(input: { baseUrl: string; runId?: string | null; memberId?: number | null; ttlMs?: number }): string;
  resolve(token: string): ByokProxyTarget | null;
  revoke(token: string): void;
  size(): number;
}

export function createByokProxyRegistry(options: { now?: () => number } = {}): ByokProxyRegistry {
  const now = options.now ?? Date.now;
  const entries = new Map<string, ByokProxyTarget>();

  function prune(at: number): void {
    for (const [token, target] of entries) {
      if (target.expiresAt <= at) entries.delete(token);
    }
  }

  return {
    issue(input) {
      prune(now());
      const token = randomBytes(32).toString('base64url');
      const ttlMs = input.ttlMs ?? BYOK_PROXY_TOKEN_TTL_MS;
      entries.set(token, {
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        runId: input.runId ?? null,
        memberId: input.memberId ?? null,
        expiresAt: now() + ttlMs,
      });
      return token;
    },
    resolve(token) {
      if (typeof token !== 'string' || token.length === 0) return null;
      const target = entries.get(token);
      if (!target) return null;
      if (target.expiresAt <= now()) {
        entries.delete(token);
        return null;
      }
      return target;
    },
    revoke(token) {
      entries.delete(token);
    },
    size() {
      return entries.size;
    },
  };
}
