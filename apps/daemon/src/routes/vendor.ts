import type { Express } from 'express';
import { createReadStream } from 'node:fs';

import { resolveVendorRequest, verifyVendorAsset } from '../vendor/serve.js';

export interface RegisterVendorRoutesDeps {
  vendorDir: string;
  logError: (message: string) => void;
}

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * GET /vendor/* — serves the pinned offline assets (DESIGN §13.3).
 *
 * Only manifest paths are resolvable and every response is integrity-checked, so this is not a
 * general static file server. Missing files answer 503 rather than 404 so an incomplete vendor
 * checkout is distinguishable from a client asking for something that does not exist.
 */
export function registerVendorRoutes(app: Express, deps: RegisterVendorRoutesDeps): void {
  app.get('/vendor/*splat', (req, res, next) => {
    const splat = (req.params as { splat?: string | string[] }).splat;
    const relativePath = Array.isArray(splat) ? splat.join('/') : String(splat ?? '');

    const resolution = resolveVendorRequest(deps.vendorDir, relativePath);
    if (resolution.status !== 200 || !resolution.asset || !resolution.absolutePath) {
      res.status(resolution.status).json({ error: resolution.reason ?? 'not_found' });
      return;
    }

    if (!verifyVendorAsset(resolution.absolutePath, resolution.asset)) {
      deps.logError(
        '[vendor] integrity check failed for ' +
          resolution.asset.package +
          '/' +
          resolution.asset.file,
      );
      res.status(503).json({ error: 'integrity_failed' });
      return;
    }

    res.setHeader('Content-Type', resolution.asset.contentType);
    res.setHeader('Content-Length', String(resolution.asset.bytes));
    res.setHeader('Cache-Control', IMMUTABLE_CACHE);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = createReadStream(resolution.absolutePath);
    stream.on('error', (error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      next(error);
    });
    stream.pipe(res);
  });
}
