import type { Express, Response } from 'express';

import type {
  Edition,
  NextorePublicShareDescriptor,
  NextorePublicShareFailure,
  NextorePublicShareItem,
} from '@open-design/contracts';

import { applySameOriginPreviewFrameHeaders } from '../nextore-frame-guard.js';
import { NextoreClientError, type NextoreArtifactClient } from './client.js';

export interface RegisterNextorePublicShareRoutesDeps {
  client: NextoreArtifactClient;
  edition: Edition;
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
  if (error.statusCode === 400) return 400;
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
        kind?: unknown;
        fileName?: unknown;
        previewOnly?: unknown;
        expiresAt?: unknown;
        items?: unknown;
      }>(key);
      const rawItems = Array.isArray(descriptor?.items) ? descriptor.items : [];
      const items: NextorePublicShareItem[] = rawItems
        .map((item) => item as { id?: unknown; name?: unknown })
        .filter((item) => typeof item?.id === 'number' && typeof item?.name === 'string')
        .map((item) => ({
          id: item.id as number,
          name: item.name as string,
          contentUrl: '/api/public-share/' + encodeURIComponent(key) + '/item/' + String(item.id) + '/content',
        }));
      const kind = descriptor?.kind === 'folder' ? 'folder' : 'file';
      const payload: NextorePublicShareDescriptor = {
        kind,
        fileName: typeof descriptor?.fileName === 'string' ? descriptor.fileName : null,
        previewOnly: descriptor?.previewOnly === true,
        expiresAt: typeof descriptor?.expiresAt === 'string' ? descriptor.expiresAt : null,
        contentUrl: kind === 'file' ? '/api/public-share/' + encodeURIComponent(key) + '/content' : null,
        items: kind === 'folder' ? items : [],
      };
      res.json(payload);
    } catch (error) {
      res.status(statusFor(error)).json(failure(deps.client, key, error));
    }
  });

  app.get('/api/public-share/:key/content', async (req, res: Response) => {
    const key = String(req.params.key ?? '').trim();
    if (!key) {
      res.status(400).json({ error: 'invalid_key' });
      return;
    }
    await sendContent(req.params.key ?? '', key, () => deps.client.fetchPublicShareContent(key), deps, res);
  });

  app.get('/api/public-share/:key/item/:itemId/content', async (req, res: Response) => {
    const key = String(req.params.key ?? '').trim();
    const itemId = Number(req.params.itemId);
    if (!key || !Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'invalid_item' });
      return;
    }
    await sendContent(key, key, () => deps.client.fetchPublicShareItemContent(key, itemId), deps, res);
  });

  async function sendContent(
    _keyParam: string,
    key: string,
    load: () => Promise<globalThis.Response>,
    routeDeps: RegisterNextorePublicShareRoutesDeps,
    res: Response,
  ): Promise<void> {
    res.setHeader('cache-control', 'no-store');
    try {
      const upstream = await load();
      if (!upstream.ok) {
        const code = new NextoreClientError('nextore_http_error', 'upstream rejected the content request', upstream.status);
        res.status(statusFor(code)).json(failure(routeDeps.client, key, code));
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      // The shell denies framing, but the share page frames this document on
      // purpose: allow the same origin only, never the shell itself.
      applySameOriginPreviewFrameHeaders(routeDeps.edition, res);
      res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      res.setHeader('content-length', String(body.length));
      res.setHeader('content-disposition', 'inline');
      res.end(body);
    } catch (error) {
      res.status(statusFor(error)).json(failure(routeDeps.client, key, error));
    }
  }
}
