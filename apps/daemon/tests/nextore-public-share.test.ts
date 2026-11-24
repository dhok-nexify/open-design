import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NextoreClientError, type NextoreArtifactClient } from '../src/nextore/client.js';
import { registerNextorePublicShareRoutes } from '../src/nextore/public-share-routes.js';

function clientStub(handlers: {
  describePublicShare?: (key: string) => Promise<unknown>;
  fetchPublicShareContent?: (key: string) => Promise<Response>;
}): NextoreArtifactClient {
  return {
    describePublicShare: vi.fn(handlers.describePublicShare ?? (async () => ({
      fileName: 'blog-post.pdf',
      previewOnly: true,
      expiresAt: '2026-12-01T02:37:00.927',
    }))),
    fetchPublicShareContent: vi.fn(handlers.fetchPublicShareContent ?? (async () =>
      new Response('pdf-bytes', { status: 200, headers: { 'content-type': 'application/pdf' } }))),
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
  registerNextorePublicShareRoutes(app, { client });
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
      fileName: 'blog-post.pdf',
      previewOnly: true,
      expiresAt: '2026-12-01T02:37:00.927',
      contentUrl: '/api/public-share/key-1/content',
    });
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
    expect(await response.text()).toBe('pdf-bytes');
  });
});
