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
