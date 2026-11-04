import { describe, expect, it } from 'vitest';

import { resolveBrandFaviconUrl } from '../src/runtime/brand-references';

describe('resolveBrandFaviconUrl', () => {
  it('builds the public favicon URL upstream', () => {
    expect(resolveBrandFaviconUrl('example.com', 64, 'upstream')).toBe(
      'https://www.google.com/s2/favicons?domain=example.com&sz=64',
    );
  });

  it('returns an empty string in the NexTore edition so callers use their local placeholder', () => {
    expect(resolveBrandFaviconUrl('example.com', 64, 'nextore')).toBe('');
  });

  it('encodes the domain', () => {
    expect(resolveBrandFaviconUrl('例子.com', 32, 'upstream')).toContain(
      encodeURIComponent('例子.com'),
    );
  });
});
