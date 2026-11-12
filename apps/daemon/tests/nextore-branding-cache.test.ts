import { describe, expect, it, vi } from 'vitest';

import {
  createBrandingCache,
  DEFAULT_BRANDING_TTL_MS,
} from '../src/nextore/branding-cache.js';
import type { NextoreClient } from '../src/nextore/client.js';

const SNAPSHOT = {
  siteTitle: 'NexTore Designer',
  brandName: 'NexTore',
  primaryColor: '#4F46E5',
  version: 1,
};

function clientOf(branding: NextoreClient['branding']): NextoreClient {
  return {
    health: vi.fn(),
    branding,
    bootstrap: vi.fn(),
  } as unknown as NextoreClient;
}

describe('createBrandingCache', () => {
  it('refreshes the default cache within a minute so a saved brand shows up', () => {
    // Guards the regression where a five-minute TTL left an edited brand
    // invisible long after the settings page said it was saved.
    expect(DEFAULT_BRANDING_TTL_MS).toBe(60_000);
  });

  it('serves the cached snapshot within the TTL', async () => {
    let now = 1_000;
    const branding = vi.fn().mockResolvedValue(SNAPSHOT);
    const cache = createBrandingCache(clientOf(branding), { ttlMs: 100, now: () => now });

    expect((await cache.get())?.value).toEqual(SNAPSHOT);
    now = 1_050;
    expect((await cache.get())?.value).toEqual(SNAPSHOT);
    expect(branding).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the TTL', async () => {
    let now = 0;
    const branding = vi.fn().mockResolvedValue(SNAPSHOT);
    const cache = createBrandingCache(clientOf(branding), { ttlMs: 10, now: () => now });

    await cache.get();
    now = 20;
    await cache.get();
    expect(branding).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good snapshot as stale when a refresh fails', async () => {
    let now = 0;
    const branding = vi
      .fn()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockRejectedValueOnce(new Error('down'));
    const cache = createBrandingCache(clientOf(branding), { ttlMs: 10, now: () => now });

    await cache.get();
    now = 20;
    const snapshot = await cache.get();

    expect(snapshot?.stale).toBe(true);
    expect(snapshot?.value).toEqual(SNAPSHOT);
  });

  it('returns null when the first load fails', async () => {
    const branding = vi.fn().mockRejectedValue(new Error('down'));
    const cache = createBrandingCache(clientOf(branding));

    expect(await cache.get()).toBeNull();
  });

  it('deduplicates concurrent refreshes', async () => {
    let resolve!: (value: typeof SNAPSHOT) => void;
    const branding = vi.fn().mockImplementation(
      () => new Promise((done) => { resolve = done; }),
    );
    const cache = createBrandingCache(clientOf(branding));

    const first = cache.get();
    const second = cache.get();
    resolve(SNAPSHOT);

    expect((await first)?.value).toEqual(SNAPSHOT);
    expect((await second)?.value).toEqual(SNAPSHOT);
    expect(branding).toHaveBeenCalledTimes(1);
  });
});
