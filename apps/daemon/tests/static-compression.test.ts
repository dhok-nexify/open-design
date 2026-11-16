import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  IMMUTABLE_STATIC_CACHE_CONTROL,
  STATIC_MEDIA_CACHE_CONTROL,
  acceptsEncoding,
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

  function writeAsset(
    relativePath: string,
    body: string,
    options: { gzip?: boolean; brotli?: boolean; olderMtime?: boolean } = {},
  ) {
    const full = path.join(tempDir, relativePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
    if (options.gzip !== false) {
      writeFileSync(full + '.gz', gzipSync(Buffer.from(body)));
    }
    if (options.brotli !== false) {
      writeFileSync(full + '.br', brotliCompressSync(Buffer.from(body)));
    }
    if (options.olderMtime) {
      const past = new Date(Date.now() - 60_000);
      utimesSync(full + '.gz', past, past);
      utimesSync(full + '.br', past, past);
    }
    return full;
  }

  function request(url: string, headers: Record<string, string> = {}) {
    return { method: 'GET', url, headers };
  }

  it('parses Accept-Encoding quality values', () => {
    expect(acceptsEncoding('gzip, deflate, br', 'br')).toBe(true);
    expect(acceptsEncoding('gzip;q=0.5, br;q=0', 'br')).toBe(false);
    expect(acceptsEncoding('gzip;q=0.5, br;q=0', 'gzip')).toBe(true);
    expect(acceptsEncoding('identity', 'gzip')).toBe(false);
    expect(acceptsEncoding('gzip', 'br')).toBe(false);
  });

  it('prefers brotli and falls back to gzip', () => {
    writeAsset('_next/static/chunks/app.js', 'console.log("x")');
    expect(
      resolvePrecompressedAsset(
        request('/_next/static/chunks/app.js', { 'accept-encoding': 'gzip, br' }),
        tempDir,
      ),
    ).toEqual({
      url: '/_next/static/chunks/app.js.br',
      contentType: 'text/javascript; charset=utf-8',
      contentEncoding: 'br',
    });
    expect(
      resolvePrecompressedAsset(
        request('/_next/static/chunks/app.js', { 'accept-encoding': 'gzip' }),
        tempDir,
      ),
    ).toEqual({
      url: '/_next/static/chunks/app.js.gz',
      contentType: 'text/javascript; charset=utf-8',
      contentEncoding: 'gzip',
    });
  });

  it('keeps query strings and refuses non-text and range requests', () => {
    writeAsset('_next/static/chunks/app.js', 'console.log("x")');
    writeAsset('logo.png', 'png');
    expect(
      resolvePrecompressedAsset(
        request('/_next/static/chunks/app.js?v=1', { 'accept-encoding': 'br, gzip' }),
        tempDir,
      )?.url,
    ).toBe('/_next/static/chunks/app.js.br?v=1');
    expect(
      resolvePrecompressedAsset(request('/logo.png', { 'accept-encoding': 'gzip' }), tempDir),
    ).toBeNull();
    expect(
      resolvePrecompressedAsset(
        request('/_next/static/chunks/app.js', { 'accept-encoding': 'gzip', range: 'bytes=0-10' }),
        tempDir,
      ),
    ).toBeNull();
  });

  it('ignores missing or stale compressed siblings', () => {
    writeAsset('_next/static/chunks/no-gzip.js', 'console.log("x")', {
      gzip: false,
      brotli: false,
    });
    writeAsset('_next/static/chunks/stale.js', 'console.log("x")', { olderMtime: true });
    expect(
      resolvePrecompressedAsset(
        request('/_next/static/chunks/no-gzip.js', { 'accept-encoding': 'gzip' }),
        tempDir,
      ),
    ).toBeNull();
    expect(
      resolvePrecompressedAsset(
        request('/_next/static/chunks/stale.js', { 'accept-encoding': 'gzip' }),
        tempDir,
      ),
    ).toBeNull();
  });

  it('refuses to escape the static root', () => {
    writeAsset('_next/static/chunks/app.js', 'console.log("x")');
    expect(
      resolvePrecompressedAsset(
        request('/../../etc/passwd', { 'accept-encoding': 'gzip' }),
        tempDir,
      ),
    ).toBeNull();
    expect(
      resolvePrecompressedAsset(
        request('/%2e%2e/%2e%2e/etc/passwd', { 'accept-encoding': 'gzip' }),
        tempDir,
      ),
    ).toBeNull();
  });

  it('marks hashed assets immutable, media short-lived, and restores Content-Type', () => {
    const headers = new Map<string, string>();
    const res = {
      setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
    };
    const setHeaders = createStaticAssetHeaders(tempDir);

    setHeaders(res as never, path.join(tempDir, '_next/static/chunks/app.js.br'));
    expect(headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(headers.get('cache-control')).toBe(IMMUTABLE_STATIC_CACHE_CONTROL);
    expect(headers.get('vary')).toBe('Accept-Encoding');

    headers.clear();
    setHeaders(res as never, path.join(tempDir, 'app-icon.png'));
    expect(headers.get('cache-control')).toBe(STATIC_MEDIA_CACHE_CONTROL);

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
      const url = 'http://127.0.0.1:' + port + '/_next/static/chunks/app.js';
      const brotli = await fetch(url, { headers: { 'accept-encoding': 'br' } });
      expect(brotli.status).toBe(200);
      expect(brotli.headers.get('content-encoding')).toBe('br');
      expect(brotli.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(brotli.headers.get('cache-control')).toBe(IMMUTABLE_STATIC_CACHE_CONTROL);
      expect(await brotli.text()).toBe(body);

      const gzip = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
      expect(gzip.headers.get('content-encoding')).toBe('gzip');
      expect(await gzip.text()).toBe(body);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
