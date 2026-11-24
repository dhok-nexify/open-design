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

interface ModuleNode {
  kind?: unknown;
  fileName?: unknown;
  previewOnly?: unknown;
  expiresAt?: unknown;
  items?: unknown;
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
  function payload(
    key: string,
    node: ModuleNode | null,
    itemId?: number,
  ): NextorePublicShareDescriptor {
    const root = '/api/public-share/' + encodeURIComponent(key);
    // An item descriptor must stream that item, not the shared root.
    const selfContent = itemId === undefined ? root + '/content' : root + '/item/' + itemId + '/content';
    const kind = node?.kind === 'folder' ? 'folder' : 'file';
    const rawItems = Array.isArray(node?.items) ? node.items : [];
    const items: NextorePublicShareItem[] = rawItems
      .map((entry) => entry as { id?: unknown; name?: unknown; kind?: unknown })
      .filter((entry) => typeof entry?.id === 'number' && typeof entry?.name === 'string')
      .map((entry) => {
        const itemKind = entry.kind === 'folder' ? 'folder' : 'file';
        return {
          id: entry.id as number,
          name: entry.name as string,
          kind: itemKind,
          contentUrl: itemKind === 'file' ? root + '/item/' + String(entry.id) + '/content' : null,
          childrenUrl: itemKind === 'folder' ? root + '/item/' + String(entry.id) : null,
        };
      });
    return {
      kind,
      fileName: typeof node?.fileName === 'string' ? node.fileName : null,
      previewOnly: node?.previewOnly === true,
      expiresAt: typeof node?.expiresAt === 'string' ? node.expiresAt : null,
      contentUrl: kind === 'file' ? selfContent : null,
      items: kind === 'folder' ? items : [],
    };
  }

  app.get('/api/public-share/:key', async (req, res: Response) => {
    const key = String(req.params.key ?? '').trim();
    res.setHeader('cache-control', 'no-store');
    if (!key) {
      res.status(400).json({ error: 'invalid_key' });
      return;
    }
    try {
      const node = await deps.client.describePublicShare<ModuleNode>(key);
      res.json(payload(key, node));
    } catch (error) {
      res.status(statusFor(error)).json(failure(deps.client, key, error));
    }
  });

  app.get('/api/public-share/:key/item/:itemId', async (req, res: Response) => {
    const key = String(req.params.key ?? '').trim();
    const itemId = Number(req.params.itemId);
    res.setHeader('cache-control', 'no-store');
    if (!key || !Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'invalid_item' });
      return;
    }
    try {
      const node = await deps.client.describePublicShareItem<ModuleNode>(key, itemId);
      res.json(payload(key, node, itemId));
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
    await sendContent(key, () => deps.client.fetchPublicShareContent(key), deps, res);
  });

  app.get('/api/public-share/:key/item/:itemId/content', async (req, res: Response) => {
    const key = String(req.params.key ?? '').trim();
    const itemId = Number(req.params.itemId);
    if (!key || !Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'invalid_item' });
      return;
    }
    await sendContent(key, () => deps.client.fetchPublicShareItemContent(key, itemId), deps, res);
  });

  async function sendContent(
    key: string,
    load: () => Promise<globalThis.Response>,
    routeDeps: RegisterNextorePublicShareRoutesDeps,
    res: Response,
  ): Promise<void> {
    res.setHeader('cache-control', 'no-store');
    try {
      const upstream = await load();
      if (!upstream.ok) {
        const code = new NextoreClientError(
          'nextore_http_error',
          'upstream rejected the content request',
          upstream.status,
        );
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
