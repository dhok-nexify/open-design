import { isNextoreTier, type NextoreTier } from '@open-design/contracts';

/**
 * The member's Fast/Expert choice (NXD-D14).
 *
 * The preference is per browser and survives reloads; the daemon never trusts
 * it, it only turns it into a module endpoint. An unknown or unreadable value
 * falls back to Expert, which is what a new project starts on.
 */
export const NEXTORE_TIER_STORAGE_KEY = 'open-design:nextore-tier';
export const DEFAULT_NEXTORE_TIER: NextoreTier = 'expert';

type TierStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): TierStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredNextoreTier(storage: TierStorage | null = defaultStorage()): NextoreTier {
  try {
    const raw = storage?.getItem(NEXTORE_TIER_STORAGE_KEY);
    return isNextoreTier(raw) ? raw : DEFAULT_NEXTORE_TIER;
  } catch {
    return DEFAULT_NEXTORE_TIER;
  }
}

export function writeStoredNextoreTier(
  tier: NextoreTier,
  storage: TierStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(NEXTORE_TIER_STORAGE_KEY, tier);
  } catch {
    // Private mode or a full quota: the toggle still works for this page.
  }
}
