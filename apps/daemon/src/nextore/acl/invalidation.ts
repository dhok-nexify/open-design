import type { ProjectAccessCache } from './access-cache.js';

const caches = new Set<ProjectAccessCache>();

/** Authorizer hosts register their cache so inbound events can drop it. */
export function registerProjectAccessCache(cache: ProjectAccessCache): void {
  caches.add(cache);
}

/**
 * NXD-P03: drop every cached project access decision.
 *
 * A permission change must be visible on the next request; the cache TTL is a
 * fallback for missed pushes, never the primary invalidation path.
 */
export function invalidateAllProjectAccess(): void {
  for (const cache of caches) cache.invalidatePrefix('');
}
