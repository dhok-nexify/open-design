import { describe, expect, it } from 'vitest';

import {
  OFFLINE_FONT_DIRECTIVE,
  OFFLINE_VENDOR_URLS,
  applyOfflinePromptConstraints,
  applyOfflineVendorUrls,
} from '../src/prompts/offline-vendor.js';

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

    expect(upstream).not.toContain('## Offline fonts');

    const nextore = composeSystemPrompt({ edition: 'nextore' });
    expect(nextore).toContain('/vendor/react@18.3.1/umd/react.development.js');
    expect(nextore).toContain('## Offline fonts');
    expect(nextore).toContain('/vendor/@babel/standalone@7.29.0/babel.min.js');
    expect(nextore).not.toContain('https://unpkg.com/react@18.3.1');
    expect(nextore).not.toContain('https://unpkg.com/@babel/standalone@7.29.0');
  });
});

describe('applyOfflinePromptConstraints', () => {
  it('is a byte-identical no-op upstream', () => {
    const text = 'https://unpkg.com/react@18.3.1/umd/react.development.js';
    expect(applyOfflinePromptConstraints(text, 'upstream')).toBe(text);
  });

  it('rewrites URLs and appends the font whitelist last in the NexTore edition', () => {
    const text = 'https://unpkg.com/react@18.3.1/umd/react.development.js';
    const out = applyOfflinePromptConstraints(text, 'nextore');

    expect(out).toContain('/vendor/react@18.3.1/umd/react.development.js');
    expect(out).toContain('## Offline fonts');
    expect(out).toContain('Noto Serif SC');
    expect(out).toContain('Do not add @import or <link> tags that fetch fonts from a network.');
    expect(out.endsWith(OFFLINE_FONT_DIRECTIVE)).toBe(true);
  });

  it('appends the directive to an empty prompt', () => {
    expect(applyOfflinePromptConstraints('', 'nextore')).toBe(OFFLINE_FONT_DIRECTIVE);
  });
});
