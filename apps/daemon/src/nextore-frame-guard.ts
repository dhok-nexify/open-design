import type { Edition } from '@open-design/contracts';

/**
 * The Designer shell must never be framed (NXD-D25).
 *
 * Clickjacking a design tool means the attacker's page draws the real UI and
 * harvests clicks. NexTore opens Designer as a top-level page, so refusing all
 * ancestors costs nothing — but artifacts and device frames ARE iframed by the
 * shell, and they are served from their own routes, so those paths are exempt.
 */
const EMBEDDABLE_PREFIXES = ['/artifacts', '/frames', '/vendor'] as const;

export function isEmbeddablePath(pathname: string): boolean {
  return EMBEDDABLE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

export interface FrameGuardTarget {
  setHeader(name: string, value: string): unknown;
}

/**
 * Applies the frame-deny headers in the NexTore edition only, and only to
 * responses that are not legitimately embedded. Returns whether headers were
 * written, so callers (and tests) can assert the decision.
 */
export function applyFrameDenyHeaders(
  edition: Edition,
  pathname: string,
  target: FrameGuardTarget,
): boolean {
  if (edition !== 'nextore') return false;
  if (isEmbeddablePath(pathname)) return false;
  target.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  target.setHeader('X-Frame-Options', 'DENY');
  return true;
}
