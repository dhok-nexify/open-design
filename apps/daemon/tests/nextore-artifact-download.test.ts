import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NextoreArtifactRecord } from '@open-design/contracts';

import {
  NextoreClientError,
  createNextoreClient,
  type NextoreArtifactClient,
} from '../src/nextore/client.js';
import type { NextoreConfig } from '../src/nextore/config.js';
import {
  registerNextoreArtifactDownloadRoutes,
  type RegisterNextoreArtifactDownloadRoutesDeps,
} from '../src/nextore/artifacts/download-routes.js';
import type { NextoreArtifactRuntime } from '../src/nextore/artifacts/runtime.js';

const config: NextoreConfig = {
  baseUrl: 'http://nextore.test',
  oauthClientId: 'client',
  designerBaseUrl: 'http://designer.test',
  secretFile: '/run/secrets/designer',
  trustProxy: null,
};

function record(overrides: Partial<NextoreArtifactRecord> = {}): NextoreArtifactRecord {
  return {
    projectId: 'project-1',
    artifactId: 'artifact-1',
    representation: 'source',
    relativePath: 'dist/index.html',
    treeObjectId: 501,
    currentVersion: 3,
    contentHash: 'a'.repeat(64),
    status: 'published',
    publishedAt: 1,
    updatedAt: 1,
    orphanedAt: null,
    lastError: null,
    ...overrides,
  };
}

function runtimeStub(state: {
  record?: NextoreArtifactRecord | null;
  nextoreProjectId?: string | null;
  token?: string | null;
  mode?: 'off' | 'publish' | 'publish+share';
}): NextoreArtifactRuntime {
  return {
    mode: state.mode ?? 'publish',
    artifactRecord: vi.fn(() => state.record ?? null),
    nextoreProjectId: vi.fn(() => state.nextoreProjectId ?? 'nc-77'),
    accessTokenFor: vi.fn(async () => state.token ?? 'token-1'),
  } as unknown as NextoreArtifactRuntime;
}

function clientStub(handlers: {
  artifact?: (...args: unknown[]) => Promise<Response>;
  project?: (...args: unknown[]) => Promise<Response>;
}): NextoreArtifactClient {
  return {
    publishArtifact: vi.fn(),
    downloadArtifact: vi.fn(handlers.artifact ?? (async () => new Response(''))),
    downloadProject: vi.fn(handlers.project ?? (async () => new Response(''))),
  } as unknown as NextoreArtifactClient;
}

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

async function startApp(deps: {
  runtime: NextoreArtifactRuntime | null;
  client: NextoreArtifactClient | null;
  readProjectName?: (projectId: string) => string | null;
  deny?: boolean;
}): Promise<string> {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.nextoreSession = { memberId: 7 };
    next();
  });
  registerNextoreArtifactDownloadRoutes(app, {
    runtime: deps.runtime,
    client: deps.client,
    authorizeProject: async (_req, res) => {
      if (deps.deny) {
        res.status(403).json({ error: 'forbidden' });
        return false;
      }
      return true;
    },
    ...(deps.readProjectName ? { readProjectName: deps.readProjectName } : {}),
  } satisfies RegisterNextoreArtifactDownloadRoutesDeps);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('nextore artifact download routes', () => {
  it('answers feature_disabled while the artifact authority is off', async () => {
    const client = clientStub({});
    const baseUrl = await startApp({
      runtime: runtimeStub({ mode: 'off' }),
      client,
    });

    const response = await fetch(baseUrl + '/api/nextore/projects/project-1/download');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'feature_disabled' });
    expect(client.downloadProject).not.toHaveBeenCalled();
  });

  it('streams a published representation with an RFC 5987 filename', async () => {
    const client = clientStub({
      artifact: async () => new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html', 'content-length': '13' },
      }),
    });
    const runtime = runtimeStub({
      record: record({ relativePath: 'dist/品牌 手冊.html' }),
    });
    const base = await startApp({ runtime, client });

    const response = await fetch(`${base}/api/nextore/projects/project-1/artifacts/artifact-1/download`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html></html>');
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('content-length')).toBe('13');
    expect(response.headers.get('accept-ranges')).toBe('none');
    expect(response.headers.get('content-disposition'))
      .toContain(`filename*=UTF-8''${encodeURIComponent('品牌 手冊.html')}`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('forwards Range and relays 206 headers', async () => {
    const downloadArtifact = vi.fn(async () => new Response('html', {
      status: 206,
      headers: {
        'content-type': 'text/html',
        'content-length': '4',
        'content-range': 'bytes 0-3/13',
        'accept-ranges': 'bytes',
      },
    }));
    const client = clientStub({ artifact: downloadArtifact });
    const runtime = runtimeStub({ record: record() });
    const base = await startApp({ runtime, client });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/artifact-1/download?representation=snapshot&version=2`,
      { headers: { range: 'bytes=0-3' } },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-3/13');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(downloadArtifact).toHaveBeenCalledWith(
      'token-1',
      'nc-77',
      'artifact-1',
      { representation: 'snapshot', version: 2, range: 'bytes=0-3' },
      expect.any(AbortSignal),
    );
  });

  it('answers 409 when the representation was never published', async () => {
    const client = clientStub({});
    const runtime = runtimeStub({ record: null });
    const base = await startApp({ runtime, client });

    const response = await fetch(`${base}/api/nextore/projects/project-1/artifacts/artifact-1/download`);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'artifact_not_published' });
    expect(client.downloadArtifact).not.toHaveBeenCalled();
  });

  it('answers 409 while the queue still owns the representation', async () => {
    const client = clientStub({});
    const runtime = runtimeStub({ record: record({ status: 'publish_pending' }) });
    const base = await startApp({ runtime, client });

    const response = await fetch(`${base}/api/nextore/projects/project-1/artifacts/artifact-1/download`);

    expect(response.status).toBe(409);
    expect(((await response.json()) as { message: string }).message).toContain('publish_pending');
  });

  it('rejects an unknown representation before calling NexTore', async () => {
    const client = clientStub({});
    const runtime = runtimeStub({ record: record() });
    const base = await startApp({ runtime, client });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/artifact-1/download?representation=raw`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_representation' });
    expect(client.downloadArtifact).not.toHaveBeenCalled();
  });

  it('propagates the module 403 instead of downgrading it', async () => {
    const client = clientStub({
      artifact: async () => {
        throw new NextoreClientError('nextore_http_error', 'no download right', 403, 'artifact_forbidden');
      },
    });
    const runtime = runtimeStub({ record: record() });
    const base = await startApp({ runtime, client });

    const response = await fetch(`${base}/api/nextore/projects/project-1/artifacts/artifact-1/download`);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'artifact_forbidden' });
  });

  it('maps an upstream outage to 503 with Retry-After', async () => {
    const client = clientStub({
      artifact: async () => {
        throw new NextoreClientError('nextore_http_error', 'storage offline', 503);
      },
    });
    const runtime = runtimeStub({ record: record() });
    const base = await startApp({ runtime, client });

    const response = await fetch(`${base}/api/nextore/projects/project-1/artifacts/artifact-1/download`);

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(await response.json()).toMatchObject({ error: 'nextore_unavailable' });
  });

  it('zips the project under the mapped NexTore id and the local name', async () => {
    const downloadProject = vi.fn(async () => new Response('zip-bytes', {
      status: 200,
      headers: { 'content-type': 'application/zip' },
    }));
    const client = clientStub({ project: downloadProject });
    const runtime = runtimeStub({});
    const base = await startApp({ runtime, client, readProjectName: () => '品牌手冊' });

    const response = await fetch(`${base}/api/nextore/projects/project-1/download`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('zip-bytes');
    expect(response.headers.get('content-disposition'))
      .toContain(`filename*=UTF-8''${encodeURIComponent('品牌手冊.zip')}`);
    expect(downloadProject).toHaveBeenCalledWith(
      'token-1',
      'nc-77',
      {},
      expect.any(AbortSignal),
    );
  });

  it('requires a NexTore session', async () => {
    const app = express();
    const runtime = runtimeStub({ record: record() });
    registerNextoreArtifactDownloadRoutes(app, {
      runtime,
      client: clientStub({}),
      authorizeProject: async () => true,
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/nextore/projects/project-1/artifacts/artifact-1/download`,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'SESSION_REQUIRED' });
  });
});

describe('nextore download client', () => {
  it('sends the Range header and the API key to the module', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createNextoreClient({
      config,
      fetch: (async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response('abc', {
          status: 206,
          headers: { 'content-type': 'text/html', 'content-range': 'bytes 0-2/10' },
        });
      }) as unknown as typeof fetch,
    });

    const response = await client.downloadArtifact('token-1', '77', 'artifact-1', {
      representation: 'snapshot',
      version: 4,
      range: 'bytes=0-2',
    });

    expect(response.status).toBe(206);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'http://nextore.test/api/designer/projects/77/artifacts/artifact-1/download?representation=snapshot&version=4',
    );
    expect((calls[0]!.init.headers as Record<string, string>).APIkey).toBe('token-1');
    expect((calls[0]!.init.headers as Record<string, string>).range).toBe('bytes=0-2');
  });

  it('surfaces the upstream error code', async () => {
    const client = createNextoreClient({
      config,
      fetch: (async () => new Response(JSON.stringify({ error: 'artifact_forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
    });

    await expect(client.downloadProject('token-1', '77', {})).rejects.toMatchObject({
      name: 'NextoreClientError',
      statusCode: 403,
      upstreamCode: 'artifact_forbidden',
    });
  });
});
