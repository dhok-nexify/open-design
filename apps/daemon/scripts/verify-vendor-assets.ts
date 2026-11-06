import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VENDOR_ASSETS } from '../src/vendor/manifest.js';

/**
 * Build-time check that the checked-out vendor tree still matches the pinned
 * manifest (NXD-D32).
 *
 * The runtime verifies every byte it serves, so a mismatch ships as a 503 on a
 * page the user is looking at. Running the same check before a deploy turns
 * that into one line of build output — and catches the most common cause on
 * Windows: a checkout that converted the vendored files' line endings.
 */
const vendorRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor');
let failures = 0;

for (const asset of VENDOR_ASSETS) {
  const label = asset.package + '/' + asset.file;
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(vendorRoot, asset.package, asset.file));
  } catch {
    console.error('missing  ' + label);
    failures += 1;
    continue;
  }
  if (bytes.byteLength !== asset.bytes) {
    console.error(
      'size     ' + label + ': got ' + bytes.byteLength + ', expected ' + asset.bytes
        + (bytes.byteLength > asset.bytes ? ' (line-ending conversion?)' : ''),
    );
    failures += 1;
    continue;
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) {
    console.error('sha256   ' + label);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(failures + ' vendor asset(s) do not match the manifest');
  process.exit(1);
}
console.log('vendor ok: ' + VENDOR_ASSETS.length + ' assets');
