import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NEXTORE_TIER,
  NEXTORE_TIER_STORAGE_KEY,
  readStoredNextoreTier,
  writeStoredNextoreTier,
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

describe('NexTore tier preference', () => {
  it('defaults to expert when nothing is stored', () => {
    expect(DEFAULT_NEXTORE_TIER).toBe('expert');
    expect(readStoredNextoreTier(memoryStorage())).toBe('expert');
  });

  it('reads a stored tier', () => {
    expect(readStoredNextoreTier(memoryStorage({ [NEXTORE_TIER_STORAGE_KEY]: 'fast' }))).toBe('fast');
  });

  it('ignores a value that is not a tier', () => {
    expect(readStoredNextoreTier(memoryStorage({ [NEXTORE_TIER_STORAGE_KEY]: 'turbo' }))).toBe('expert');
  });

  it('survives storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredNextoreTier(throwing)).toBe('expert');
    expect(() => writeStoredNextoreTier('fast', throwing)).not.toThrow();
  });

  it('writes the chosen tier', () => {
    const storage = memoryStorage();
    writeStoredNextoreTier('fast', storage);
    expect(storage.dump()).toEqual({ [NEXTORE_TIER_STORAGE_KEY]: 'fast' });
  });
});
