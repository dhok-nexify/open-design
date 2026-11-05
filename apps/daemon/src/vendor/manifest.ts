/**
 * The pinned offline asset set served from /vendor/<package>/<file>.
 *
 * Generated artifacts and previews must not reach an external CDN, so every asset they may
 * reference is checked into apps/daemon/vendor/ and listed here. This list is the allowlist:
 * a path that is not in it is never resolved against the filesystem. sha256 makes a tampered
 * or half-copied checkout fail loudly instead of serving different bytes under a URL the
 * prompts treat as immutable.
 *
 * Versions are pinned to the strings the prompts and preview builders emit:
 *   apps/daemon/src/prompts/official-system.ts
 *   packages/contracts/src/prompts/official-system.ts
 *   apps/daemon/src/design-systems/index.ts
 *   apps/web/src/runtime/react-component.ts
 *   apps/web/src/components/DesignSystemFlow.tsx
 * Keep this table and those strings in sync; vendor-routes.test.ts checks the files on disk.
 */
export interface VendorAsset {
  /** name@version; scoped package names keep their slash (@babel/standalone@7.29.0). */
  package: string;
  /** Path inside the package, forward slashes only. */
  file: string;
  contentType: string;
  /** Lower-case hex SHA-256 of the bytes on disk. */
  sha256: string;
  /** Size in bytes; checked before hashing so a truncated copy fails fast. */
  bytes: number;
}

export const VENDOR_ASSETS: readonly VendorAsset[] = [
  {
    package: 'react@18.3.1',
    file: 'umd/react.development.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: '28348fef6cb0ed8b2ceeb22deaf824428fd13875d84c73d38f77dd216fc24e7f',
    bytes: 109931,
  },
  {
    package: 'react-dom@18.3.1',
    file: 'umd/react-dom.development.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: 'f9044a5e9c39db8bb1a204dff924e526ec0a621e695bb69de1035811be8709e4',
    bytes: 1080227,
  },
  {
    package: '@babel/standalone@7.29.0',
    file: 'babel.min.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: '2623a9e22809915ce789b4461154e277ddce520d5a4320c14d44332a5d0dcea0',
    bytes: 3137752,
  },
  {
    package: 'framer-motion@11.11.13',
    file: 'dist/framer-motion.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: '2282c76027bbb429223a0d3c3b9bcc40b7f2f47ca9980059881aa56fc8bf41bc',
    bytes: 141825,
  },
  {
    package: 'tailwindcss@3.4.17',
    file: 'play-cdn.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: '176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15',
    bytes: 407279,
  },
  {
    package: 'fonts@1.0.0',
    file: 'fonts.css',
    contentType: 'text/css; charset=utf-8',
    sha256: '4cde9cd70580a471dc998ee9432df434daadc0f8e6066c89efd33ba8cb200663',
    bytes: 13124,
  },
  {
    package: 'gsap@3.14.2',
    file: 'dist/gsap.min.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: 'c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280',
    bytes: 72779,
  },
  {
    package: 'chart.js@4.4.0',
    file: 'dist/chart.umd.min.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: '0e2326c6868072bec1592760c6729043caeea2960a2b46cee6a2192aac6abff0',
    bytes: 205222,
  },
  {
    package: 'chart.js@4.4.3',
    file: 'dist/chart.umd.min.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: 'd46d97a1fd022c5fb29fa2f45ebcbc32202d73aeebf076ce5f7248f5498fc7d7',
    bytes: 205637,
  },
  {
    package: 'chart.js@4.4.7',
    file: 'dist/chart.umd.min.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: '206b6e8bb00fc7bba2c7ee80ca41db3e9e05ba7be0aa35abeba9cfd5357f5d0e',
    bytes: 205889,
  },
  {
    package: 'highlight.js@11.10.0',
    file: 'lib/core.min.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: 'fd003f7cbcb0aa571268634db469242b78ae20245568a76dc0471528fb8e33a6',
    bytes: 23319,
  },
  {
    package: 'highlight.js@11.10.0',
    file: 'lib/languages/javascript.min.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: '7999d974ab587f2dd1173212c77afef0cc3565278ef8ff71e2eabf1950361fd0',
    bytes: 6958,
  },
  {
    package: 'highlight.js@11.10.0',
    file: 'styles/tokyo-night-dark.min.css',
    contentType: 'text/css; charset=utf-8',
    sha256: '3c24d046d2e1e02b9e8beb641f9dc639c76ff44ad89f0fbac9eab9062d55f51b',
    bytes: 1234,
  },
  {
    package: 'lucide@1.68.0',
    file: 'dist/umd/lucide.min.js',
    contentType: 'text/javascript; charset=utf-8',
    sha256: '26dac98cc1ef89b939e3f032a0d1de710c1a1bf6d04df0129ff6ae76ee5ca240',
    bytes: 478389,
  },
];

/** Public URL for an asset: /vendor/<package>/<file>. */
export function vendorUrl(asset: Pick<VendorAsset, 'package' | 'file'>): string {
  return '/vendor/' + asset.package + '/' + asset.file;
}

/**
 * The manifest entry for a decoded path relative to /vendor/, or null. The match is exact: no
 * prefix, suffix or case folding, so /vendor/<anything else> can never become a file read.
 */
export function findVendorAsset(relativePath: string): VendorAsset | null {
  for (const asset of VENDOR_ASSETS) {
    if (asset.package + '/' + asset.file === relativePath) return asset;
  }
  return null;
}
