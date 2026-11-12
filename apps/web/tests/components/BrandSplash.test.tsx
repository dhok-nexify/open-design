// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The startup curtain is the only dark surface in a light-only app, so its
 * contract is worth pinning: nothing flashes for a fast boot, and a slow boot
 * shows the dark-surface logo, the configured loading text and the brand bar.
 */
describe('BrandSplash', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('waits out a fast boot, then shows the configured brand', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          siteTitle: '',
          brandName: 'Acme',
          primaryColor: '#123456',
          logoDark: '/dark.svg',
          loadingText: 'Starting Acme…',
          version: 1,
        }),
      }),
    );

    const branding = await import('../../src/nextore/branding');
    await branding.bootstrapBranding();
    const { BrandSplash } = await import('../../src/components/BrandSplash');

    render(<BrandSplash />);
    expect(screen.queryByTestId('brand-splash')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    const splash = screen.getByTestId('brand-splash');
    expect(splash.querySelector('img')?.getAttribute('src')).toContain('/dark.svg');
    expect(screen.getByText('Starting Acme…')).toBeTruthy();
  });

  it('keeps the plain light loader upstream', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'upstream');
    vi.resetModules();
    const { BrandSplash } = await import('../../src/components/BrandSplash');

    render(<BrandSplash />);

    expect(screen.queryByTestId('brand-splash')).toBeNull();
    expect(document.querySelector('.centered-loader')).not.toBeNull();
  });
});
