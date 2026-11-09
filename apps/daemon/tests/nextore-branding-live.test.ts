import { describe, expect, it, vi } from 'vitest';

import { createBrandingCache } from '../src/nextore/branding-cache.js';
import type { NextoreClient } from '../src/nextore/client.js';

describe('branding cache live wire shape', () => {
  it('normalizes PascalCase branding before caching', async () => {
    const branding = vi.fn().mockResolvedValue({
      SiteTitle: 'NexTore Designer',
      BrandName: 'NexTore Designer',
      PrimaryColor: '#4F46E5',
      Version: 5309426729634911000,
    });
    const client = { health: vi.fn(), branding, bootstrap: vi.fn() } as unknown as NextoreClient;
    const cache = createBrandingCache(client);

    const snapshot = await cache.get();

    expect(snapshot?.value).toMatchObject({
      siteTitle: 'NexTore Designer',
      brandName: 'NexTore Designer',
      primaryColor: '#4F46E5',
    });
    expect(snapshot?.value.version).toBe(5309426729634911000);
  });
});
