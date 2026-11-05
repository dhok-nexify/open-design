import type { NextoreBrandingResponse } from '@open-design/contracts';

import type { NextoreClient } from './client.js';

export interface BrandingCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

export interface BrandingSnapshot {
  value: NextoreBrandingResponse;
  stale: boolean;
}

export interface BrandingCache {
  get(): Promise<BrandingSnapshot | null>;
  clear(): void;
}

const DEFAULT_TTL_MS = 5 * 60_000;

/**
 * TTL cache over the module branding endpoint (DESIGN §12.1).
 *
 * The shell asks for branding on every boot; NexTore does not need a round trip per request, but a
 * settings change must become visible without restarting the daemon. A five-minute TTL matches the
 * documented branding cache, and a failed refresh keeps serving the last good snapshot (flagged
 * stale) instead of blanking the product.
 */
export function createBrandingCache(
  client: NextoreClient,
  options: BrandingCacheOptions = {},
): BrandingCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { at: number; value: NextoreBrandingResponse } | null = null;
  let inflight: Promise<NextoreBrandingResponse> | null = null;

  async function refresh(): Promise<NextoreBrandingResponse> {
    const value = await client.branding();
    cached = { at: now(), value };
    return value;
  }

  return {
    async get(): Promise<BrandingSnapshot | null> {
      if (cached && now() - cached.at < ttlMs) {
        return { value: cached.value, stale: false };
      }

      try {
        inflight ??= refresh().finally(() => {
          inflight = null;
        });
        return { value: await inflight, stale: false };
      } catch {
        return cached ? { value: cached.value, stale: true } : null;
      }
    },

    clear(): void {
      cached = null;
    },
  };
}
