import { describe, expect, it } from 'vitest';

import { OFFLINE_VENDOR_URLS, applyOfflineVendorUrls } from '../src/prompts/offline-vendor.js';

describe('applyOfflineVendorUrls', () => {
  it('leaves upstream text byte-identical', () => {
    const text = OFFLINE_VENDOR_URLS.map((pair) => pair.upstream).join('\n');
    expect(applyOfflineVendorUrls(text, 'upstream')).toBe(text);
  });

  it('rewrites every pinned URL in the NexTore edition', () => {
    const text = OFFLINE_VENDOR_URLS.map((pair) => pair.upstream).join('\n');
    const rewritten = applyOfflineVendorUrls(text, 'nextore');

    for (const pair of OFFLINE_VENDOR_URLS) {
      expect(rewritten).toContain(pair.vendored);
      expect(rewritten).not.toContain(pair.upstream);
    }
  });

  it('does not rewrite an unrelated URL', () => {
    const text = 'https://unpkg.com/other-package@1.0.0/index.js';
    expect(applyOfflineVendorUrls(text, 'nextore')).toBe(text);
  });

  it('handles empty text', () => {
    expect(applyOfflineVendorUrls('', 'nextore')).toBe('');
  });
});

describe('composeSystemPrompt edition gating', () => {
  it('rewrites the composed prompt only in the NexTore edition', async () => {
    const { composeSystemPrompt } = await import('../src/prompts/system.js');

    const upstream = composeSystemPrompt({});
    expect(upstream).toContain('https://unpkg.com/react@18.3.1/umd/react.development.js');

    const nextore = composeSystemPrompt({ edition: 'nextore' });
    expect(nextore).toContain('/vendor/react@18.3.1/umd/react.development.js');
    expect(nextore).toContain('/vendor/@babel/standalone@7.29.0/babel.min.js');
    expect(nextore).not.toContain('https://unpkg.com/react@18.3.1');
    expect(nextore).not.toContain('https://unpkg.com/@babel/standalone@7.29.0');
  });
});
