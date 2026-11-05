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
  {
    upstream: 'https://cdn.tailwindcss.com',
    vendored: '/vendor/tailwindcss@3.4.17/play-cdn.js',
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

export const OFFLINE_VENDOR_DIRECTIVE = [
  '## Offline runtime assets',
  '',
  'Load the pinned runtimes from /vendor/ (the snippet above already points there in this deployment). For Tailwind, use /vendor/tailwindcss@3.4.17/play-cdn.js instead of the public Tailwind CDN script. Never fetch these runtimes from a CDN.',
].join('\n');

export const OFFLINE_FONT_DIRECTIVE = [
  '## Offline fonts',
  '',
  'This deployment renders without Google Fonts or any other external font service. Use only these families: ' +
    OFFLINE_FONT_WHITELIST.join(', ') +
    '.',
  'When a design system, template, or reference names another family, substitute the closest one from this list and keep the intended weight and character.',
  'Load <link rel="stylesheet" href="/vendor/fonts@1.0.0/fonts.css"> once in the document head; it resolves every family from host-installed faces without a network request.',
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
  const directives = OFFLINE_VENDOR_DIRECTIVE + '\n\n' + OFFLINE_FONT_DIRECTIVE;
  return rewritten.length === 0 ? directives : rewritten + '\n\n' + directives;
}
