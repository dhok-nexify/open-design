import type { NextoreBrandingResponse } from '@open-design/contracts';

import type { NextoreClient } from './client.js';
import { normalizeBranding } from './wire.js';

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

/**
 * How long a snapshot is served before the daemon asks the module again.
 *
 * Kept at one minute on purpose: an administrator who saves a new brand expects
 * it to reach the Designer on the next refresh, and a failed refresh keeps
 * serving the last good snapshot (flagged stale) instead of blanking the
 * product. The same cache feeds prompt composition, so one small anonymous GET
 * per minute also keeps agent-facing text current.
 */
export const DEFAULT_BRANDING_TTL_MS = 60_000;

export function createBrandingCache(
  client: NextoreClient,
  options: BrandingCacheOptions = {},
): BrandingCache {
  const ttlMs = options.ttlMs ?? DEFAULT_BRANDING_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { at: number; value: NextoreBrandingResponse } | null = null;
  let inflight: Promise<NextoreBrandingResponse> | null = null;

  async function refresh(): Promise<NextoreBrandingResponse> {
    const value = normalizeBranding(await client.branding());
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
