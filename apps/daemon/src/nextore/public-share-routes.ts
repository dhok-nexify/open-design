import type { Express, Response } from 'express';

import type {
  NextorePublicShareDescriptor,
  NextorePublicShareFailure,
} from '@open-design/contracts';

import { NextoreClientError, type NextoreArtifactClient } from './client.js';

export interface RegisterNextorePublicShareRoutesDeps {
  client: NextoreArtifactClient;
}

function failure(
  client: NextoreArtifactClient,
  key: string,
  error: unknown,
): NextorePublicShareFailure {
  const code = error instanceof NextoreClientError
    ? (error.upstreamCode ?? 'share_unavailable')
    : 'share_unavailable';
  return { error: code, fallbackUrl: client.publicShareFallbackUrl(key) };
}

function statusFor(error: unknown): number {
  if (!(error instanceof NextoreClientError)) return 502;
  if (error.statusCode === 410) return 410;
  if (error.statusCode === 404) return 404;
  return 502;
}

/**
 * Anonymous endpoints behind the branded share page.
 *
 * The browser never talks to NexTore directly: the daemon relays the key to the
 * module, which resolves it against the platform share record on every call.
 * Nothing here reads a NexTore session, so a recipient holding only the link can
 * open it.
 */
export function registerNextorePublicShareRoutes(
  app: Express,
  deps: RegisterNextorePublicShareRoutesDeps,
): void {
  app.get('/api/public-share/:key', async (req, res: Response) => {
    const key = String(req.params.key ?? '').trim();
    res.setHeader('cache-control', 'no-store');
    if (!key) {
      res.status(400).json({ error: 'invalid_key' });
      return;
    }
    try {
      const descriptor = await deps.client.describePublicShare<{
        fileName?: unknown;
        previewOnly?: unknown;
        expiresAt?: unknown;
      }>(key);
      const payload: NextorePublicShareDescriptor = {
        fileName: typeof descriptor?.fileName === 'string' ? descriptor.fileName : null,
        previewOnly: descriptor?.previewOnly === true,
        expiresAt: typeof descriptor?.expiresAt === 'string' ? descriptor.expiresAt : null,
        contentUrl: '/api/public-share/' + encodeURIComponent(key) + '/content',
      };
      res.json(payload);
    } catch (error) {
      res.status(statusFor(error)).json(failure(deps.client, key, error));
    }
  });

  app.get('/api/public-share/:key/content', async (req, res: Response) => {
    const key = String(req.params.key ?? '').trim();
    res.setHeader('cache-control', 'private, no-store');
    if (!key) {
      res.status(400).json({ error: 'invalid_key' });
      return;
    }
    try {
      const upstream = await deps.client.fetchPublicShareContent(key);
      if (!upstream.ok) {
        const code = new NextoreClientError('nextore_http_error', 'upstream rejected the content request', upstream.status);
        res.status(statusFor(code)).json(failure(deps.client, key, code));
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      res.setHeader('content-length', String(body.length));
      res.setHeader('content-disposition', 'inline');
      res.end(body);
    } catch (error) {
      res.status(statusFor(error)).json(failure(deps.client, key, error));
    }
  });
}
