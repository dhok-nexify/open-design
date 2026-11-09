import { describe, expect, it } from 'vitest';

import {
  nextoreTierStorageKeyForProject,
  readStoredNextoreTierForProject,
  writeStoredNextoreTierForProject,
} from '../src/nextore/tier';

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    dump: () => Object.fromEntries(data),
  };
}

describe('per-project NexTore tier', () => {
  it('starts a new project on Expert even when the global preference is Fast', () => {
    const storage = memoryStorage({ 'open-design:nextore-tier': 'fast' });
    expect(readStoredNextoreTierForProject('project-1', storage)).toBe('expert');
  });

  it('keeps each project choice separate', () => {
    const storage = memoryStorage();
    writeStoredNextoreTierForProject('project-1', 'fast', storage);
    writeStoredNextoreTierForProject('project-2', 'expert', storage);
    expect(readStoredNextoreTierForProject('project-1', storage)).toBe('fast');
    expect(readStoredNextoreTierForProject('project-2', storage)).toBe('expert');
    expect(storage.dump()).toHaveProperty(nextoreTierStorageKeyForProject('project-1'), 'fast');
  });
});
