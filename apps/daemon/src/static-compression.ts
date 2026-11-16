import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';

/**
 * Text assets worth serving from a build-time gzip sibling. Binary formats that
 * are already compressed (woff2, png, webp, mp4) are deliberately excluded.
 */
const PRECOMPRESSED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.txt',
  '.xml',
  '.webmanifest',
  '.ttf',
]);

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ttf': 'font/ttf',
};

/**
 * `_next/static` file names embed a content hash, so a cached copy can never go
 * stale. Everything else keeps the conservative revalidate-every-time default.
 */
export const IMMUTABLE_STATIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Non-hashed public assets (tab icons, brand images, the UI font) get a short
 * shared cache instead of the revalidate-every-time default. A day keeps
 * deploys predictable while removing a repeat download on every page view.
 */
export const STATIC_MEDIA_CACHE_CONTROL = 'public, max-age=86400';

const STATIC_MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.ico', '.svg', '.woff2', '.ttf']);

export interface PrecompressedRequestLike {
  readonly method: string;
  readonly url: string;
  readonly headers: {
    readonly 'accept-encoding'?: string | string[] | undefined;
    readonly range?: string | string[] | undefined;
  };
}

export interface PrecompressedAsset {
  /** URL to hand to `express.static`, including the encoding suffix. */
  readonly url: string;
  /** MIME type of the uncompressed file (the response body stays compressed). */
  readonly contentType: string;
  /** Encoding the chosen sibling file carries. */
  readonly contentEncoding: 'br' | 'gzip';
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(',');
  return value ?? '';
}

/** True when the client accepts `encoding` at a non-zero quality. */
export function acceptsEncoding(header: string, encoding: 'br' | 'gzip'): boolean {
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (name !== encoding) continue;
    const quality = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (!quality) return true;
    const value = Number(quality.slice(2));
    return !Number.isFinite(value) || value > 0;
  }
  return false;
}

function freshSibling(filePath: string, sourceMtimeMs: number, suffix: string): boolean {
  try {
    const stat = fs.statSync(filePath + suffix);
    return stat.isFile() && stat.size > 0 && stat.mtimeMs >= sourceMtimeMs;
  } catch {
    return false;
  }
}

/**
 * Decide which (if any) precompressed sibling should answer a request. Pure
 * apart from `statSync` so the daemon's routing tests can exercise every branch.
 * Brotli wins when both encodings are available; gzip remains for older clients.
 */
export function resolvePrecompressedAsset(
  req: PrecompressedRequestLike,
  staticDir: string,
): PrecompressedAsset | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const accepted = firstHeaderValue(req.headers['accept-encoding']);
  if (!accepted) return null;
  // Range requests must see the original byte offsets.
  if (firstHeaderValue(req.headers.range)) return null;

  const [rawPathname, search = ''] = (req.url || '').split('?');
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname || '');
  } catch {
    return null;
  }
  if (!pathname || pathname.includes('\0')) return null;

  const extension = path.extname(pathname).toLowerCase();
  if (!PRECOMPRESSED_EXTENSIONS.has(extension)) return null;

  const root = path.resolve(staticDir);
  const filePath = path.resolve(root, '.' + pathname);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;

  let sourceMtimeMs: number;
  try {
    const source = fs.statSync(filePath);
    if (!source.isFile()) return null;
    sourceMtimeMs = source.mtimeMs;
  } catch {
    return null;
  }

  const candidates: Array<{ suffix: string; encoding: 'br' | 'gzip' }> = [
    { suffix: '.br', encoding: 'br' },
    { suffix: '.gz', encoding: 'gzip' },
  ];
  for (const candidate of candidates) {
    if (!acceptsEncoding(accepted, candidate.encoding)) continue;
    if (!freshSibling(filePath, sourceMtimeMs, candidate.suffix)) continue;
    return {
      url: pathname + candidate.suffix + (search ? '?' + search : ''),
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
      contentEncoding: candidate.encoding,
    };
  }
  return null;
}

/**
 * Rewrites the request onto its precompressed sibling and marks the response
 * encoding. `express.static` then keeps ownership of ETag, 304 and byte serving.
 */
export function createPrecompressedStaticMiddleware(staticDir: string): RequestHandler {
  return (req, res, next) => {
    const asset = resolvePrecompressedAsset(
      { method: req.method, url: req.url, headers: req.headers },
      staticDir,
    );
    if (!asset) return next();
    res.setHeader('Content-Encoding', asset.contentEncoding);
    res.setHeader('Vary', 'Accept-Encoding');
    req.url = asset.url;
    next();
  };
}

/**
 * `express.static` cannot know that a `.gz` file represents its uncompressed
 * sibling, so this restores the original Content-Type and adds the immutable
 * cache policy for content-hashed framework assets.
 */
export function createStaticAssetHeaders(
  staticDir: string,
): (res: ServerResponse, filePath: string) => void {
  const root = path.resolve(staticDir);
  return (res, filePath) => {
    const compressionSuffix = filePath.endsWith('.br')
      ? '.br'
      : filePath.endsWith('.gz')
        ? '.gz'
        : '';
    const servedPath = compressionSuffix ? filePath.slice(0, -compressionSuffix.length) : filePath;
    const extension = path.extname(servedPath).toLowerCase();

    if (compressionSuffix) {
      const type = CONTENT_TYPES[extension];
      if (type) res.setHeader('Content-Type', type);
    }
    if (PRECOMPRESSED_EXTENSIONS.has(extension)) {
      // Compressed and identity bodies share one URL, so caches must key on the
      // accepted encoding.
      res.setHeader('Vary', 'Accept-Encoding');
    }

    const relative = path.relative(root, servedPath).split(path.sep).join('/');
    if (relative === '_next/static' || relative.startsWith('_next/static/')) {
      res.setHeader('Cache-Control', IMMUTABLE_STATIC_CACHE_CONTROL);
    } else if (STATIC_MEDIA_EXTENSIONS.has(extension)) {
      res.setHeader('Cache-Control', STATIC_MEDIA_CACHE_CONTROL);
    }
  };
}
