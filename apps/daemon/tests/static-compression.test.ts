import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  IMMUTABLE_STATIC_CACHE_CONTROL,
  createPrecompressedStaticMiddleware,
  createStaticAssetHeaders,
  resolvePrecompressedAsset,
} from '../src/static-compression.js';

describe('precompressed static assets', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-static-gzip-'));
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  function writeAsset(relativePath: string, body: string, options: { gzip?: boolean; gzipOlder?: boolean } = {}) {
    const full = path.join(tempDir, relativePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
    if (options.gzip !== false) {
      writeFileSync(full + '.gz', gzipSync(Buffer.from(body)));
      if (options.gzipOlder) {
        const past = new Date(Date.now() - 60_000);
        utimesSync(full + '.gz', past, past);
      }
    }
    return full;
  }

  function request(url: string, headers: Record<string, string> = {}) {
    return { method: 'GET', url, headers };
  }

  it('returns a gzip sibling only when the client accepts gzip', () => {
    writeAsset('_next/static/chunks/app.js', 'console.log("x")');
    expect(resolvePrecompressedAsset(request('/_next/static/chunks/app.js'), tempDir))
      .toBeNull();
    expect(resolvePrecompressedAsset(
      request('/_next/static/chunks/app.js', { 'accept-encoding': 'gzip, deflate' }),
      tempDir,
    )).toEqual({
      url: '/_next/static/chunks/app.js.gz',
      contentType: 'text/javascript; charset=utf-8',
    });
  });

  it('keeps query strings and refuses non-text and range requests', () => {
    writeAsset('_next/static/chunks/app.js', 'console.log("x")');
    writeAsset('logo.png', 'png');
    expect(resolvePrecompressedAsset(
      request('/_next/static/chunks/app.js?v=1', { 'accept-encoding': 'br, gzip' }),
      tempDir,
    )?.url).toBe('/_next/static/chunks/app.js.gz?v=1');
    expect(resolvePrecompressedAsset(
      request('/logo.png', { 'accept-encoding': 'gzip' }),
      tempDir,
    )).toBeNull();
    expect(resolvePrecompressedAsset(
      request('/_next/static/chunks/app.js', { 'accept-encoding': 'gzip', range: 'bytes=0-10' }),
      tempDir,
    )).toBeNull();
  });

  it('ignores missing or stale gzip siblings', () => {
    writeAsset('_next/static/chunks/no-gzip.js', 'console.log("x")', { gzip: false });
    writeAsset('_next/static/chunks/stale.js', 'console.log("x")', { gzipOlder: true });
    expect(resolvePrecompressedAsset(
      request('/_next/static/chunks/no-gzip.js', { 'accept-encoding': 'gzip' }),
      tempDir,
    )).toBeNull();
    expect(resolvePrecompressedAsset(
      request('/_next/static/chunks/stale.js', { 'accept-encoding': 'gzip' }),
      tempDir,
    )).toBeNull();
  });

  it('refuses to escape the static root', () => {
    writeAsset('_next/static/chunks/app.js', 'console.log("x")');
    expect(resolvePrecompressedAsset(
      request('/../../etc/passwd', { 'accept-encoding': 'gzip' }),
      tempDir,
    )).toBeNull();
    expect(resolvePrecompressedAsset(
      request('/%2e%2e/%2e%2e/etc/passwd', { 'accept-encoding': 'gzip' }),
      tempDir,
    )).toBeNull();
  });

  it('marks content-hashed framework assets immutable and restores Content-Type', () => {
    const headers = new Map<string, string>();
    const res = { setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value) };
    const setHeaders = createStaticAssetHeaders(tempDir);

    setHeaders(res as never, path.join(tempDir, '_next/static/chunks/app.js.gz'));
    expect(headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(headers.get('cache-control')).toBe(IMMUTABLE_STATIC_CACHE_CONTROL);

    headers.clear();
    setHeaders(res as never, path.join(tempDir, 'index.html'));
    expect(headers.get('cache-control')).toBeUndefined();
  });

  it('serves the compressed body through express with correct headers', async () => {
    const body = 'const answer = 42;'.repeat(200);
    writeAsset('_next/static/chunks/app.js', body);

    const app = express();
    app.use(createPrecompressedStaticMiddleware(tempDir));
    app.use(express.static(tempDir, { setHeaders: createStaticAssetHeaders(tempDir) }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch('http://127.0.0.1:' + port + '/_next/static/chunks/app.js', {
        headers: { 'accept-encoding': 'gzip' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-encoding')).toBe('gzip');
      expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe(IMMUTABLE_STATIC_CACHE_CONTROL);
      expect(await response.text()).toBe(body);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
