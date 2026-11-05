import { DEFAULT_PRODUCT_BRAND_NAME } from '@open-design/contracts';

import type { BrandingSnapshot } from './branding-cache.js';

/**
 * Process-wide handle on the branding cache.
 *
 * The HTTP route and prompt composition both need the same cached payload, but
 * they are registered in different layers: `registerNextoreRoutes` owns the
 * cache instance, while the generation path in `server.ts` composes prompts.
 * A module-level registry keeps one cache per daemon process without exporting
 * route internals or duplicating the five-minute refresh.
 *
 * Only the NexTore edition registers a source. Upstream therefore resolves the
 * built-in default and its prompts stay byte-identical.
 */
export interface BrandingSource {
  get(): Promise<BrandingSnapshot | null>;
}

let source: BrandingSource | null = null;

export function registerBrandingSource(next: BrandingSource | null): void {
  source = next;
}

/**
 * Resolves the product name used in agent-facing prompts.
 *
 * A missing cache, an unreachable NexTore, or a blank branding value all fall
 * back to the default name instead of failing prompt composition: the run must
 * still be able to start when branding is temporarily unavailable.
 */
export async function resolveProductBrandName(): Promise<string> {
  if (!source) return DEFAULT_PRODUCT_BRAND_NAME;
  try {
    const snapshot = await source.get();
    return snapshot?.value.brandName?.trim() || DEFAULT_PRODUCT_BRAND_NAME;
  } catch {
    return DEFAULT_PRODUCT_BRAND_NAME;
  }
}
