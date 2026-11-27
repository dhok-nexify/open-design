import { isNextoreTier } from '@open-design/contracts';

/**
 * Project-level model preference for the NexTore edition (P12).
 *
 * Project is the single source of truth. A one-time read of the legacy per-project
 * tier key migrates existing users; after that only the model key is written.
 */
export const NEXTORE_MODEL_STORAGE_KEY = 'open-design:nextore-model';
export const DEFAULT_NEXTORE_MODEL_KEY = 'expert';

type ModelStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): ModelStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function nextoreModelStorageKeyForProject(projectId: string): string {
  return NEXTORE_MODEL_STORAGE_KEY + ':' + projectId;
}

/** New projects inherit this Home-level choice; an existing project keeps its own. */
export function readStoredNextoreModelKey(
  storage: ModelStorage | null = defaultStorage(),
): string {
  try {
    const stored = storage?.getItem(NEXTORE_MODEL_STORAGE_KEY);
    if (isValidNextoreModelKey(stored)) return stored;
    const legacy = storage?.getItem('open-design:nextore-tier');
    if (isNextoreTier(legacy)) return legacy;
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_NEXTORE_MODEL_KEY;
}

export function writeStoredNextoreModelKey(
  modelKey: string,
  storage: ModelStorage | null = defaultStorage(),
): void {
  if (!isValidNextoreModelKey(modelKey)) return;
  try {
    storage?.setItem(NEXTORE_MODEL_STORAGE_KEY, modelKey);
  } catch {
    // The selection still applies to the current page.
  }
}

export function isValidNextoreModelKey(value: unknown): value is string {
  return typeof value === 'string'
    && (isNextoreTier(value) || /^model:\d+$/.test(value));
}

export function readStoredNextoreModelKeyForProject(
  projectId: string,
  storage: ModelStorage | null = defaultStorage(),
): string {
  try {
    const stored = storage?.getItem(nextoreModelStorageKeyForProject(projectId));
    if (isValidNextoreModelKey(stored)) return stored;

    // One-time migration from Fast/Expert preferences. Do not keep writing the
    // old key: two writable sources drift apart.
    const legacy = storage?.getItem('open-design:nextore-tier:' + projectId)
      ?? storage?.getItem('open-design:nextore-tier');
    if (isNextoreTier(legacy)) {
      storage?.setItem(nextoreModelStorageKeyForProject(projectId), legacy);
      return legacy;
    }
  } catch {
    // Private mode or a full quota: keep the in-memory default for this page.
  }
  return DEFAULT_NEXTORE_MODEL_KEY;
}

export function writeStoredNextoreModelKeyForProject(
  projectId: string,
  modelKey: string,
  storage: ModelStorage | null = defaultStorage(),
): void {
  if (!isValidNextoreModelKey(modelKey)) return;
  try {
    storage?.setItem(nextoreModelStorageKeyForProject(projectId), modelKey);
  } catch {
    // The selection still applies to the current page.
  }
}
