// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyBranding, bootstrapBranding, resetBrandingCache } from '../src/nextore/branding';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  resetBrandingCache();
  document.head.innerHTML = '';
  document.title = '';
});

describe('applyBranding', () => {
  it('applies the title, favicon, theme color and brand variable', () => {
    applyBranding({
      siteTitle: 'Acme Design',
      brandName: 'Acme',
      favicon: '/favicon.ico',
      primaryColor: '#123456',
      version: 1,
    });

    expect(document.title).toBe('Acme Design');
    const icon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    expect(icon.getAttribute('href') ?? icon.href).toContain('/favicon.ico');
    expect(
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    ).toBe('#123456');
    expect(
      document.documentElement.style.getPropertyValue('--nexTore-brand-primary'),
    ).toBe('#123456');
  });

  it('leaves missing fields alone', () => {
    document.title = 'Existing';
    applyBranding({
      siteTitle: '',
      brandName: '',
      primaryColor: '',
      version: 2,
    });
    expect(document.title).toBe('Existing');
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
  });
});

describe('bootstrapBranding', () => {
  it('does nothing upstream', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'upstream');
    vi.resetModules();
    const mod = await import('../src/nextore/branding');
    expect(await mod.bootstrapBranding()).toBeNull();
  });

  it('fetches and applies branding in the edition', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ siteTitle: 'NexTore', brandName: 'NexTore', primaryColor: '#4F46E5', version: 3 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('../src/nextore/branding');
    const branding = await mod.bootstrapBranding();

    expect(branding?.siteTitle).toBe('NexTore');
    expect(document.title).toBe('NexTore');
    expect(fetchMock).toHaveBeenCalledWith('/api/branding', expect.anything());

    const second = await mod.bootstrapBranding();
    expect(second?.version).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
