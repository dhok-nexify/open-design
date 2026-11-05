import type { Express, RequestHandler, Response } from 'express';
import type { NextoreSelfTestCheck, NextoreSelfTestResponse } from '@open-design/contracts';
import { NextoreClientError, type NextoreClient } from './client.js';
import { createBrandingCache, type BrandingCache } from './branding-cache.js';
import { registerBrandingSource } from './branding-state.js';

export interface RegisterNextoreRoutesDeps {
  client: NextoreClient;
  brandingCache?: BrandingCache;
}

function failedCheck(error: unknown): NextoreSelfTestCheck {
  if (error instanceof NextoreClientError) {
    return {
      status: 'unavailable',
      message: error.code,
      ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
    };
  }
  return { status: 'unavailable', message: 'nextore_request_failed' };
}

export function nextoreHealthMetadata(edition: 'upstream' | 'nextore', version: unknown) {
  if (edition !== 'nextore') return {};
  return {
    edition,
    compat: {
      module: '>=1.0 <2',
    },
    version,
  };
}

export function createNextoreSelfTestHandler(
  client: NextoreClient,
): RequestHandler {
  return async (_req, res: Response) => {
    const [moduleResult, brandingResult] = await Promise.allSettled([
      client.health(),
      client.branding(),
    ]);

    const moduleCheck: NextoreSelfTestCheck = moduleResult.status === 'fulfilled'
      ? { status: 'ok' }
      : failedCheck(moduleResult.reason);
    const brandingCheck: NextoreSelfTestCheck = brandingResult.status === 'fulfilled'
      ? { status: 'ok' }
      : failedCheck(brandingResult.reason);

    const response: NextoreSelfTestResponse = {
      ok: moduleCheck.status === 'ok' && brandingCheck.status === 'ok',
      edition: 'nextore',
      checks: {
        module: moduleCheck,
        branding: brandingCheck,
        authentication: {
          status: 'pending_session',
          message: 'Authentication checks are available after the OAuth session is established.',
        },
        llm: {
          status: 'pending_session',
          message: 'Model checks require an authenticated NexTore session.',
        },
      },
    };

    res.setHeader('Cache-Control', 'no-store');
    res.json(response);
  };
}

export function registerNextoreRoutes(
  app: Express,
  deps: RegisterNextoreRoutesDeps,
): void {
  app.get('/api/nextore/self-test', createNextoreSelfTestHandler(deps.client));

  // Public, cached brand payload for the Designer shell (DESIGN §12.1). The module endpoint is
  // already anonymous; the daemon caches it so every boot does not round-trip to NexTore.
  const brandingCache = deps.brandingCache ?? createBrandingCache(deps.client);
  // Prompt composition reads the same cache, so a renamed installation reaches
  // agent-facing text on the same five-minute refresh as the shell (DESIGN §12.1).
  registerBrandingSource(brandingCache);
  app.get('/api/branding', async (req, res: Response) => {
    const snapshot = await brandingCache.get();
    if (!snapshot) {
      res.status(503).json({ error: 'branding_unavailable' });
      return;
    }

    const etag = 'W/"' + snapshot.value.version + '"';
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('ETag', etag);
    if (snapshot.stale) res.setHeader('X-Branding-Stale', '1');

    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((value) => value.trim() === etag)) {
      res.status(304).end();
      return;
    }

    res.json(snapshot.value);
  });
}
