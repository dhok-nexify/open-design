import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NextoreClientError, type NextoreArtifactClient } from '../src/nextore/client.js';
import { registerNextorePublicShareRoutes } from '../src/nextore/public-share-routes.js';

function clientStub(handlers: {
  describePublicShare?: (key: string) => Promise<unknown>;
  fetchPublicShareContent?: (key: string) => Promise<Response>;
  fetchPublicShareItemContent?: (key: string, itemId: number) => Promise<Response>;
}): NextoreArtifactClient {
  return {
    describePublicShare: vi.fn(handlers.describePublicShare ?? (async () => ({
      fileName: 'blog-post.pdf',
      previewOnly: true,
      expiresAt: '2026-12-01T02:37:00.927',
    }))),
    fetchPublicShareContent: vi.fn(handlers.fetchPublicShareContent ?? (async () =>
      new Response('pdf-bytes', { status: 200, headers: { 'content-type': 'application/pdf' } }))),
    fetchPublicShareItemContent: vi.fn(handlers.fetchPublicShareItemContent ?? (async () =>
      new Response('item-bytes', { status: 200, headers: { 'content-type': 'text/html' } }))),
    publicShareFallbackUrl: (key: string) => 'https://v4.nexify.hk/PublicShare?key=' + key,
  } as unknown as NextoreArtifactClient;
}

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

async function startApp(client: NextoreArtifactClient): Promise<string> {
  const app = express();
  registerNextorePublicShareRoutes(app, { client, edition: 'nextore' });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return 'http://127.0.0.1:' + port;
}

describe('public share routes', () => {
  it('returns the descriptor with a same-origin content url', async () => {
    const base = await startApp(clientStub({}));
    const response = await fetch(base + '/api/public-share/key-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: 'file',
      fileName: 'blog-post.pdf',
      previewOnly: true,
      expiresAt: '2026-12-01T02:37:00.927',
      contentUrl: '/api/public-share/key-1/content',
      items: [],
    });
  });

  it('maps a folder share to its child pages', async () => {
    const base = await startApp(clientStub({
      describePublicShare: async () => ({
        kind: 'folder',
        fileName: 'Project One',
        previewOnly: true,
        expiresAt: null,
        items: [
          { id: 11, name: 'index.html' },
          { id: 12, name: 'blog-post.pdf' },
        ],
      }),
    }));
    const response = await fetch(base + '/api/public-share/key-folder');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: 'folder',
      fileName: 'Project One',
      previewOnly: true,
      expiresAt: null,
      contentUrl: null,
      items: [
        { id: 11, name: 'index.html', contentUrl: '/api/public-share/key-folder/item/11/content' },
        { id: 12, name: 'blog-post.pdf', contentUrl: '/api/public-share/key-folder/item/12/content' },
      ],
    });
  });

  it('streams one child of a folder share', async () => {
    const client = clientStub({});
    const base = await startApp(client);
    const response = await fetch(base + '/api/public-share/key-folder/item/12/content');
    expect(response.status).toBe(200);
    expect(client.fetchPublicShareItemContent).toHaveBeenCalledWith('key-folder', 12);
  });

  it('answers 410 with the NexTore fallback when the key is gone', async () => {
    const base = await startApp(clientStub({
      describePublicShare: async () => {
        throw new NextoreClientError('nextore_http_error', 'gone', 410, 'share_expired');
      },
    }));
    const response = await fetch(base + '/api/public-share/key-2');
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'share_expired',
      fallbackUrl: 'https://v4.nexify.hk/PublicShare?key=key-2',
    });
  });

  it('streams the content bytes with the upstream content type', async () => {
    const base = await startApp(clientStub({}));
    const response = await fetch(base + '/api/public-share/key-3/content');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(response.headers.get('x-frame-options')).toBeNull();
    expect(await response.text()).toBe('pdf-bytes');
  });
});
