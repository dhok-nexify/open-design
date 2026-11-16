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

export interface PrecompressedRequestLike {
  readonly method: string;
  readonly url: string;
  readonly headers: {
    readonly 'accept-encoding'?: string | string[] | undefined;
    readonly range?: string | string[] | undefined;
  };
}

export interface PrecompressedAsset {
  /** URL to hand to `express.static`, including the `.gz` suffix. */
  readonly url: string;
  /** MIME type of the uncompressed file (the response body stays gzip). */
  readonly contentType: string;
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(',');
  return value ?? '';
}

/**
 * Decide whether a request should be answered with the precompressed sibling
 * instead of the original file. Pure apart from `statSync` so the daemon's
 * routing tests can exercise every branch.
 */
export function resolvePrecompressedAsset(
  req: PrecompressedRequestLike,
  staticDir: string,
): PrecompressedAsset | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (!/\bgzip\b/.test(firstHeaderValue(req.headers['accept-encoding']))) return null;
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

  const gzipPath = filePath + '.gz';
  try {
    const source = fs.statSync(filePath);
    const compressed = fs.statSync(gzipPath);
    if (!source.isFile() || !compressed.isFile() || compressed.size === 0) return null;
    if (compressed.mtimeMs < source.mtimeMs) return null;
  } catch {
    return null;
  }

  return {
    url: pathname + '.gz' + (search ? '?' + search : ''),
    contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
  };
}

/**
 * Rewrites the request onto its `.gz` sibling and marks the response as gzip.
 * `express.static` then keeps ownership of ETag, 304 and byte serving.
 */
export function createPrecompressedStaticMiddleware(staticDir: string): RequestHandler {
  return (req, res, next) => {
    const asset = resolvePrecompressedAsset(
      { method: req.method, url: req.url, headers: req.headers },
      staticDir,
    );
    if (!asset) return next();
    res.setHeader('Content-Encoding', 'gzip');
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
    const servedPath = filePath.endsWith('.gz') ? filePath.slice(0, -3) : filePath;
    const extension = path.extname(servedPath).toLowerCase();
    if (PRECOMPRESSED_EXTENSIONS.has(extension)) {
      // Both the gzip and identity bodies share one URL, so caches must key on
      // the accepted encoding.
      res.setHeader('Vary', 'Accept-Encoding');
    }
    if (servedPath !== filePath) {
      const type = CONTENT_TYPES[extension];
      if (type) res.setHeader('Content-Type', type);
    }
    const relative = path.relative(root, servedPath).split(path.sep).join('/');
    if (relative === '_next/static' || relative.startsWith('_next/static/')) {
      res.setHeader('Cache-Control', IMMUTABLE_STATIC_CACHE_CONTROL);
    }
  };
}
