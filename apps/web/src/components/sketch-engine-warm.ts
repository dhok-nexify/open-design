/**
 * The sketch engine (Excalidraw) is a multi-megabyte chunk. Prewarming it on
 * the home page is only worth the bytes for people who actually sketch and are
 * not on a metered or slow connection, so both signals gate the warm-up.
 */
export const SKETCH_ENGINE_WARM_KEY = 'open-design:sketch-engine-warm';

const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g']);

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
}

/** Remember that this browser has opened a sketch at least once. */
export function markSketchEngineUsed(): void {
  try {
    window.localStorage.setItem(SKETCH_ENGINE_WARM_KEY, '1');
  } catch {
    /* storage can be unavailable in private modes; warm-up simply stays off */
  }
}

/**
 * True when an idle prewarm is worth its bandwidth: the user has sketched
 * before, data-saver is off, and the connection is not in a slow class.
 */
export function shouldPrewarmSketchEngine(): boolean {
  try {
    if (window.localStorage.getItem(SKETCH_ENGINE_WARM_KEY) !== '1') return false;
  } catch {
    return false;
  }
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType && SLOW_EFFECTIVE_TYPES.has(connection.effectiveType)) return false;
  return true;
}
