import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Static half of T-D106: the bundled examples and templates must not reference a public runtime
 * CDN, and every /vendor reference they carry must exist in apps/daemon/vendor. Together with
 * vendor-routes.test.ts (manifest <-> bytes) this closes the chain HTML -> disk -> manifest.
 *
 * Known debt, tracked in docs/nextore/D32-ASSET-RUNBOOK.md: the two showcase videos on
 * repo-assets.open-design.ai and the GitHub avatar images are still external. They are deliberately
 * not scanned here because vendoring them is a separate step; add their hosts to FORBIDDEN_HOSTS
 * once they are local.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT_DIRS = ['design-templates', 'skills'] as const;
const FORBIDDEN_HOSTS = [
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
] as const;
const VENDOR_DIR = path.join(repoRoot, 'apps', 'daemon', 'vendor');
const VENDOR_REF = /\/vendor\/([A-Za-z0-9@._/-]+)/g;

async function collectHtmlFiles(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectHtmlFiles(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

async function isFile(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isFile();
  } catch {
    return false;
  }
}

const htmlFiles = (
  await Promise.all(CONTENT_DIRS.map((dir) => collectHtmlFiles(path.join(repoRoot, dir))))
).flat();

describe('offline content assets', () => {
  it('scans the bundled example and template catalogue', () => {
    expect(htmlFiles.length).toBeGreaterThan(100);
  });

  it('never references a public runtime CDN', async () => {
    const offenders: string[] = [];
    for (const file of htmlFiles) {
      const html = await readFile(file, 'utf8');
      for (const host of FORBIDDEN_HOSTS) {
        if (html.includes(host)) {
          offenders.push(path.relative(repoRoot, file) + ' -> ' + host);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only references /vendor paths that exist on disk', async () => {
    const missing: string[] = [];
    for (const file of htmlFiles) {
      const html = await readFile(file, 'utf8');
      for (const match of html.matchAll(VENDOR_REF)) {
        const relative = match[1] ?? '';
        if (!(await isFile(path.join(VENDOR_DIR, relative)))) {
          missing.push(path.relative(repoRoot, file) + ' -> /vendor/' + relative);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
