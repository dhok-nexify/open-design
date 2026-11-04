import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { registerVendorRoutes } from '../src/routes/vendor.js';
import { VENDOR_ASSETS, findVendorAsset, vendorUrl } from '../src/vendor/manifest.js';
import {
  isSafeVendorRelativePath,
  resetVendorIntegrityCache,
} from '../src/vendor/serve.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = path.resolve(HERE, '..', 'vendor');
const REACT_PATH = 'react@18.3.1/umd/react.development.js';
const REACT_ASSET = VENDOR_ASSETS[0]!;

const servers: http.Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  resetVendorIntegrityCache();
});

async function listen(app: express.Express): Promise<string> {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener.');
  return 'http://127.0.0.1:' + address.port;
}

function appFor(vendorDir: string): express.Express {
  const app = express();
  registerVendorRoutes(app, { vendorDir, logError: () => {} });
  return app;
}

function tempVendorDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-vendor-'));
  tempDirs.push(dir);
  return dir;
}

describe('vendor manifest', () => {
  it('pins every asset to the bytes checked into apps/daemon/vendor', () => {
    for (const asset of VENDOR_ASSETS) {
      const file = path.join(VENDOR_DIR, asset.package, asset.file);
      expect(fs.existsSync(file), asset.package + '/' + asset.file).toBe(true);
      const bytes = fs.readFileSync(file);
      expect(bytes.length, asset.package + ' size').toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.package + ' sha256').toBe(
        asset.sha256,
      );
    }
  });

  it('builds the documented /vendor/<package>/<file> URL', () => {
    expect(vendorUrl(REACT_ASSET)).toBe('/vendor/react@18.3.1/umd/react.development.js');
  });

  it('matches manifest entries exactly', () => {
    expect(findVendorAsset(REACT_PATH)).not.toBeNull();
    expect(findVendorAsset(REACT_PATH.toUpperCase())).toBeNull();
    expect(findVendorAsset('react@18.3.1/umd/package.json')).toBeNull();
  });

  it('rejects traversal, absolute and non-plain relative paths', () => {
    expect(isSafeVendorRelativePath(REACT_PATH)).toBe(true);
    for (const value of [
      '',
      '/etc/passwd',
      '../package.json',
      'react@18.3.1/../package.json',
      'react@18.3.1//umd/react.development.js',
      'react@18.3.1\\umd\\react.development.js',
      './react.development.js',
      'react@18.3.1/umd/../../package.json',
    ]) {
      expect(isSafeVendorRelativePath(value), value).toBe(false);
    }
  });
});

describe('GET /vendor/*', () => {
  it('serves a pinned asset with immutable caching and integrity headers', async () => {
    const baseUrl = await listen(appFor(VENDOR_DIR));
    const response = await fetch(baseUrl + '/vendor/' + REACT_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(REACT_ASSET.bytes);
  });

  it('answers HEAD with headers and no body', async () => {
    const baseUrl = await listen(appFor(VENDOR_DIR));
    const response = await fetch(baseUrl + '/vendor/' + REACT_PATH, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it('refuses a file that exists on disk but is not in the manifest', async () => {
    const baseUrl = await listen(appFor(VENDOR_DIR));
    const response = await fetch(baseUrl + '/vendor/react@18.3.1/LICENSE');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('refuses traversal attempts', async () => {
    const baseUrl = await listen(appFor(VENDOR_DIR));
    for (const attempt of [
      '/vendor/../package.json',
      '/vendor/react@18.3.1/%2e%2e/package.json',
      '/vendor/react@18.3.1/umd/..%2f..%2fpackage.json',
    ]) {
      const response = await fetch(baseUrl + attempt);
      expect([404, 400], attempt).toContain(response.status);
    }
  });

  it('answers 503 when a manifest file is missing from the checkout', async () => {
    const baseUrl = await listen(appFor(tempVendorDir()));
    const response = await fetch(baseUrl + '/vendor/' + REACT_PATH);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'missing_file' });
  });

  it('answers 503 when the bytes do not match the manifest hash', async () => {
    const dir = tempVendorDir();
    const target = path.join(dir, REACT_PATH);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'tampered');

    const baseUrl = await listen(appFor(dir));
    const response = await fetch(baseUrl + '/vendor/' + REACT_PATH);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'integrity_failed' });
  });
});
