import { describe, expect, it } from 'vitest';

import { publicFaviconServicesAllowed } from '../src/brands/offline-policy.js';

describe('publicFaviconServicesAllowed', () => {
  it('allows third-party favicon services upstream', () => {
    expect(publicFaviconServicesAllowed({})).toBe(true);
    expect(publicFaviconServicesAllowed({ OD_EDITION: 'upstream' })).toBe(true);
    expect(publicFaviconServicesAllowed({ OD_EDITION: '   ' })).toBe(true);
  });

  it('disables them in the NexTore edition', () => {
    expect(publicFaviconServicesAllowed({ OD_EDITION: 'nextore' })).toBe(false);
    expect(publicFaviconServicesAllowed({ OD_EDITION: ' nextore ' })).toBe(false);
  });

  it('fails closed on an unknown edition', () => {
    expect(() => publicFaviconServicesAllowed({ OD_EDITION: 'preview' })).toThrow(
      /Unsupported edition/,
    );
  });
});
