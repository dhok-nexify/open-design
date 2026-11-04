import type { Edition } from '../nextore/edition.js';

/**
 * Pinned third-party asset URLs a prompt or preview may carry, and the daemon's offline
 * equivalent (DESIGN §13.3). This table is the single source of truth for the rewrite; the
 * daemon vendor manifest (apps/daemon/src/vendor/manifest.ts) is the single source of truth
 * for what /vendor actually serves. packages/contracts/tests/offline-vendor.test.ts pins the
 * mapping, and the composer applies it only in the NexTore edition so upstream prompts stay
 * byte-identical.
 */
export const OFFLINE_VENDOR_URLS: ReadonlyArray<{ upstream: string; vendored: string }> = [
  {
    upstream: 'https://unpkg.com/react@18.3.1/umd/react.development.js',
    vendored: '/vendor/react@18.3.1/umd/react.development.js',
  },
  {
    upstream: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js',
    vendored: '/vendor/react-dom@18.3.1/umd/react-dom.development.js',
  },
  {
    upstream: 'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
    vendored: '/vendor/@babel/standalone@7.29.0/babel.min.js',
  },
  {
    upstream: 'https://unpkg.com/framer-motion@11.11.13/dist/framer-motion.js',
    vendored: '/vendor/framer-motion@11.11.13/dist/framer-motion.js',
  },
];

/** Rewrites the pinned asset URLs to /vendor in the NexTore edition; upstream is untouched. */
export function applyOfflineVendorUrls(text: string, edition: Edition): string {
  if (edition !== 'nextore' || text.length === 0) return text;

  let result = text;
  for (const pair of OFFLINE_VENDOR_URLS) {
    result = result.split(pair.upstream).join(pair.vendored);
  }
  return result;
}

/**
 * Core offline font whitelist (DESIGN §13.3). The NexTore edition renders without Google Fonts,
 * so a request for any other family is mapped onto the closest one here at generation time.
 */
export const OFFLINE_FONT_WHITELIST = [
  'Inter',
  'Inter Tight',
  'Source Serif 4',
  'Playfair Display',
  'Space Grotesk',
  'JetBrains Mono',
  'Noto Sans HK',
  'Noto Serif HK',
  'Noto Sans SC',
  'Noto Serif SC',
] as const;

export const OFFLINE_FONT_DIRECTIVE = [
  '## Offline fonts',
  '',
  'This deployment renders without Google Fonts or any other external font service. Use only these families: ' +
    OFFLINE_FONT_WHITELIST.join(', ') +
    '.',
  'When a design system, template, or reference names another family, substitute the closest one from this list and keep the intended weight and character.',
  'Do not add @import or <link> tags that fetch fonts from a network.',
].join('\n');

/**
 * The edition's prompt constraints: pinned CDN URLs become /vendor paths, and the font whitelist
 * directive is appended last so it outranks design-system typography instructions. Upstream text
 * is returned byte-identical.
 */
export function applyOfflinePromptConstraints(text: string, edition: Edition): string {
  if (edition !== 'nextore') return text;
  const rewritten = applyOfflineVendorUrls(text, edition);
  return rewritten.length === 0 ? OFFLINE_FONT_DIRECTIVE : rewritten + '\n\n' + OFFLINE_FONT_DIRECTIVE;
}
