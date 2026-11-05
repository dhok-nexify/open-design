import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRODUCT_BRAND_NAME } from '@open-design/contracts';

import {
  registerBrandingSource,
  resolveProductBrandName,
} from '../src/nextore/branding-state.js';

const SNAPSHOT = {
  siteTitle: 'Contoso Studio',
  brandName: 'Contoso Studio',
  primaryColor: '#4F46E5',
  version: 3,
};

afterEach(() => {
  registerBrandingSource(null);
});

describe('resolveProductBrandName', () => {
  it('falls back to the built-in name when no source is registered', async () => {
    await expect(resolveProductBrandName()).resolves.toBe(DEFAULT_PRODUCT_BRAND_NAME);
  });

  it('uses the configured branding name', async () => {
    registerBrandingSource({ get: vi.fn().mockResolvedValue({ value: SNAPSHOT, stale: false }) });

    await expect(resolveProductBrandName()).resolves.toBe('Contoso Studio');
  });

  it('falls back when branding is unavailable', async () => {
    registerBrandingSource({ get: vi.fn().mockResolvedValue(null) });

    await expect(resolveProductBrandName()).resolves.toBe(DEFAULT_PRODUCT_BRAND_NAME);
  });

  it('falls back when a blank name is configured', async () => {
    registerBrandingSource({
      get: vi.fn().mockResolvedValue({ value: { ...SNAPSHOT, brandName: '  ' }, stale: false }),
    });

    await expect(resolveProductBrandName()).resolves.toBe(DEFAULT_PRODUCT_BRAND_NAME);
  });

  it('never fails prompt composition when the cache throws', async () => {
    registerBrandingSource({ get: vi.fn().mockRejectedValue(new Error('boom')) });

    await expect(resolveProductBrandName()).resolves.toBe(DEFAULT_PRODUCT_BRAND_NAME);
  });
});
