import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// NXD-D38 documentation contract: the product-facing entry points must describe
// the NexTore edition (not the upstream cloud product), the operator guide must
// cover every supported deployment shape and the settings a deployment cannot
// run without, and every relative link must resolve on disk.

const repoRoot = join(import.meta.dirname, '../..');

async function read(relativePath: string): Promise<string> {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

function relativeLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !target.startsWith('http') && !target.startsWith('#') && !target.startsWith('mailto:'))
    .map((target) => target.split('#')[0]!)
    .filter((target) => target.length > 0);
}

test('README introduces the NexTore edition and links the operator docs', async () => {
  const readme = await read('README.md');
  assert.ok(readme.includes('NexTore Designer'));
  assert.ok(readme.includes('OD_EDITION=nextore'));
  for (const link of ['docs/nextore/INSTALL.md', 'deploy/nextore/README.md', 'NOTICE', 'PRIVACY.md', 'LICENSE']) {
    assert.ok(readme.includes('](' + link + ')'), link);
  }
  // The upstream cloud pitch must not lead a NexTore deployment page.
  assert.ok(!readme.includes('open-design.ai/zh/pricing'));
});

test('NOTICE names the upstream work and its license', async () => {
  const notice = await read('NOTICE');
  assert.ok(notice.includes('OpenDesign'));
  assert.ok(notice.includes('Apache License, Version 2.0'));
  assert.ok(notice.includes('GreenSock'));
});

test('PRIVACY states the edition guarantees before the upstream policy', async () => {
  const privacy = await read('PRIVACY.md');
  const edition = privacy.indexOf('## NexTore Designer edition');
  const upstream = privacy.indexOf('## Upstream OpenDesign policy');
  assert.ok(edition === 0 || edition > 0);
  assert.ok(upstream > edition, 'edition section must come first');
  assert.match(privacy, /No product telemetry of any class/);
  assert.match(privacy, /No third-party asset requests/);
  const editionSection = privacy.slice(edition, upstream);
  assert.ok(
    !editionSection.includes('always enabled'),
    'the edition section must not inherit the upstream always-on safety telemetry claim',
  );
});

test('install guide covers all three deployment shapes', async () => {
  const install = await read('docs/nextore/INSTALL.md');
  assert.ok(install.includes('### A. Linux host'));
  assert.ok(install.includes('### B. Docker'));
  assert.ok(install.includes('### C. Windows host'));
});

test('install guide documents the settings a deployment cannot run without', async () => {
  const install = await read('docs/nextore/INSTALL.md');
  for (const name of [
    'OD_EDITION',
    'OD_DATA_DIR',
    'NEXTORE_BASE_URL',
    'NEXTORE_OAUTH_CLIENT_ID',
    'DESIGNER_BASE_URL',
    'DESIGNER_SECRET_FILE',
    'OD_SANDBOX',
    'TRUST_PROXY',
  ]) {
    assert.ok(install.includes(name), name);
  }
});

test('install guide covers verification, backup and troubleshooting', async () => {
  const install = await read('docs/nextore/INSTALL.md');
  assert.match(install, /## \d\. Verifying a new deployment/);
  assert.match(install, /## \d\. Backup and restore/);
  assert.match(install, /## \d\. Troubleshooting/);
  assert.ok(install.includes('SANDBOX_UNAVAILABLE'));
});

test('install guide follows the data-directory contract', async () => {
  const install = await read('docs/nextore/INSTALL.md');
  // Documentation must not prescribe a concrete data directory; the operator
  // chooses it through OD_DATA_DIR.
  assert.ok(!install.includes('/var/lib/nextore-designer'));
  assert.ok(!install.includes('/app/.od'));
});

test('relative links in the product docs resolve', async () => {
  for (const doc of ['README.md', 'docs/nextore/INSTALL.md', 'deploy/nextore/README.md', 'PRIVACY.md']) {
    const text = await read(doc);
    const base = dirname(join(repoRoot, doc));
    for (const link of relativeLinks(text)) {
      const target = resolve(base, link);
      assert.ok(existsSync(target), doc + ' -> ' + link);
    }
  }
});
