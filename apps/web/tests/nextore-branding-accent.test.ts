// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { setBrandName } from '../src/i18n';
import { applyBranding, resetBrandingCache } from '../src/nextore/branding';

afterEach(() => {
  resetBrandingCache();
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('style');
  document.title = '';
  setBrandName(null);
});

describe('branding accent application', () => {
  it('applies the module primary colour as the default edition accent', () => {
    document.documentElement.style.setProperty('--accent', '#353535');
    applyBranding({
      siteTitle: 'NexTore Designer',
      brandName: 'NexTore Designer',
      primaryColor: '#4F46E5',
      version: 1,
    });

    expect(document.documentElement.style.getPropertyValue('--nexTore-brand-primary')).toBe('#4F46E5');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#4f46e5');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#4F46E5');
  });

  it('preserves a non-default accent a user already selected', () => {
    document.documentElement.style.setProperty('--accent', '#1A74FF');
    applyBranding({
      siteTitle: 'NexTore Designer',
      brandName: 'NexTore Designer',
      primaryColor: '#4F46E5',
      version: 1,
    });

    expect(document.documentElement.style.getPropertyValue('--nexTore-brand-primary')).toBe('#4F46E5');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#1A74FF');
  });
});
