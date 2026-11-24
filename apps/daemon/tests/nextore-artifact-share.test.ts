import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NextoreArtifactRecord } from '@open-design/contracts';

import { NextoreClientError, type NextoreArtifactClient } from '../src/nextore/client.js';
import { registerNextoreArtifactShareRoutes } from '../src/nextore/artifacts/share-routes.js';
import type { NextoreArtifactRuntime } from '../src/nextore/artifacts/runtime.js';

function record(overrides: Partial<NextoreArtifactRecord> = {}): NextoreArtifactRecord {
  return {
    projectId: 'project-1',
    artifactId: 'artifact-1',
    representation: 'snapshot',
    relativePath: 'dist/index.pdf',
    treeObjectId: 502,
    currentVersion: 2,
    contentHash: 'b'.repeat(64),
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
  token?: string | null;
  mapping?: string | null;
} = {}): NextoreArtifactRuntime {
  return {
    artifactRecord: vi.fn(() => state.record === undefined ? record() : state.record),
    nextoreProjectId: vi.fn(() => state.mapping === undefined ? 'nc-77' : state.mapping),
    accessTokenFor: vi.fn(async () => state.token === undefined ? 'token-1' : state.token),
  } as unknown as NextoreArtifactRuntime;
}

function clientStub(handlers: {
  shareArtifact?: (...args: unknown[]) => Promise<unknown>;
  revokeArtifactShare?: (...args: unknown[]) => Promise<unknown>;
  describeArtifactShare?: (...args: unknown[]) => Promise<unknown>;
  shareProject?: (...args: unknown[]) => Promise<unknown>;
  projectShare?: (...args: unknown[]) => Promise<unknown>;
  unshareProject?: (...args: unknown[]) => Promise<unknown>;
}): NextoreArtifactClient {
  return {
    publishArtifact: vi.fn(),
    downloadArtifact: vi.fn(),
    downloadProject: vi.fn(),
    listArtifacts: vi.fn(),
    shareArtifact: vi.fn(handlers.shareArtifact ?? (async () => ({ url: 'https://share.test/s/abc' }))),
    revokeArtifactShare: vi.fn(handlers.revokeArtifactShare ?? (async () => ({ revoked: true }))),
    describeArtifactShare: vi.fn(handlers.describeArtifactShare ?? (async () => ({ shared: false, url: null }))),
    shareProject: vi.fn(handlers.shareProject ?? (async () => ({ url: 'https://share.test/s/folder' }))),
    projectShare: vi.fn(handlers.projectShare ?? (async () => ({ shared: false, url: null }))),
    unshareProject: vi.fn(handlers.unshareProject ?? (async () => ({ revoked: true }))),
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
  deny?: boolean;
  withSession?: boolean;
}): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    if (deps.withSession !== false) res.locals.nextoreSession = { memberId: 7 };
    next();
  });
  registerNextoreArtifactShareRoutes(app, {
    runtime: deps.runtime,
    client: deps.client,
    authorizeProject: async (_req, res) => {
      if (deps.deny) {
        res.status(403).json({ error: 'forbidden' });
        return false;
      }
      return true;
    },
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function postJson(base: string, path: string, body: unknown): Promise<globalThis.Response> {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('nextore folder share routes', () => {
  it('reports an existing folder link without creating one', async () => {
    const client = clientStub({
      projectShare: async () => ({ shared: true, url: 'https://share.test/PublicShare?key=abc' }),
    });
    const base = await startApp({ runtime: runtimeStub(), client });

    const response = await fetch(base + '/api/nextore/projects/project-1/share');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      shared: true,
      url: 'https://share.test/PublicShare?key=abc',
    });
    expect(client.shareProject).not.toHaveBeenCalled();
  });

  it('revokes the folder link and treats a repeat delete as already revoked', async () => {
    const client = clientStub({ unshareProject: async () => ({ revoked: false }) });
    const base = await startApp({ runtime: runtimeStub(), client });

    const response = await fetch(base + '/api/nextore/projects/project-1/share', {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revoked: false });
    expect(client.unshareProject).toHaveBeenCalledWith('token-1', 'nc-77');
  });

  it('maps a missing folder link (404 upstream) to revoked:false', async () => {
    const client = clientStub({
      unshareProject: async () => {
        throw new NextoreClientError('nextore_http_error', 'No active share link.', 404, 'share_not_found');
      },
    });
    const base = await startApp({ runtime: runtimeStub(), client });

    const response = await fetch(base + '/api/nextore/projects/project-1/share', {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revoked: false });
  });
});

describe('nextore artifact file link read route', () => {
  it('reports an existing file link without creating one', async () => {
    const client = clientStub({
      describeArtifactShare: async () => ({ shared: true, url: 'https://share.test/PublicShare?key=file' }),
    });
    const base = await startApp({ runtime: runtimeStub({ record: null }), client });

    const response = await fetch(base + '/api/nextore/projects/project-1/artifacts/artifact-1/share?representation=snapshot');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      artifactId: 'artifact-1',
      representation: 'snapshot',
      shared: true,
      url: 'https://share.test/PublicShare?key=file',
    });
    expect(client.shareArtifact).not.toHaveBeenCalled();
  });

  it('still asks the module when the local publish row is missing', async () => {
    // A link outlives the daemon row that first published it, so a read
    // must not depend on the local mapping still being present.
    const client = clientStub({});
    const base = await startApp({ runtime: runtimeStub({ record: null }), client });

    const response = await fetch(base + '/api/nextore/projects/project-1/artifacts/artifact-1/share');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ shared: false, url: null });
    expect(client.describeArtifactShare).toHaveBeenCalledWith('token-1', 'nc-77', 'artifact-1', 'snapshot');
  });

  it('answers not-shared when the module has no link for the representation', async () => {
    const client = clientStub({ describeArtifactShare: async () => ({ shared: false, url: null }) });
    const base = await startApp({ runtime: runtimeStub(), client });

    const response = await fetch(base + '/api/nextore/projects/project-1/artifacts/artifact-1/share?representation=source');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ representation: 'source', shared: false, url: null });
  });

  it('rejects an unknown representation', async () => {
    const base = await startApp({ runtime: runtimeStub(), client: clientStub({}) });

    const response = await fetch(base + '/api/nextore/projects/project-1/artifacts/artifact-1/share?representation=cover');

    expect(response.status).toBe(400);
  });
});
describe('nextore artifact share routes', () => {
  it('creates a snapshot share by default', async () => {
    const client = clientStub({});
    const runtime = runtimeStub();
    const base = await startApp({ runtime, client });

    const response = await postJson(
      base,
      '/api/nextore/projects/project-1/artifacts/artifact-1/share',
      { expiresAt: '2026-12-01T00:00:00Z', password: 'secret' },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: 'https://share.test/s/abc',
      representation: 'snapshot',
      previewOnly: true,
      pinnedVersion: null,
      hasPassword: true,
    });
    expect(client.shareArtifact).toHaveBeenCalledWith(
      'token-1',
      'nc-77',
      'artifact-1',
      expect.objectContaining({ representation: 'snapshot', previewOnly: true }),
    );
  });

  it('refuses a pinned share instead of pretending it is pinned', async () => {
    const client = clientStub({});
    const runtime = runtimeStub();
    const base = await startApp({ runtime, client });

    const response = await postJson(
      base,
      '/api/nextore/projects/project-1/artifacts/artifact-1/share',
      { pinVersion: true },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'pin_version_unsupported' });
    expect(client.shareArtifact).not.toHaveBeenCalled();
  });

  it('answers 409 when the representation is not published yet', async () => {
    const client = clientStub({});
    const runtime = runtimeStub({ record: null });
    const base = await startApp({ runtime, client });

    const response = await postJson(
      base,
      '/api/nextore/projects/project-1/artifacts/artifact-1/share',
      {},
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'share_not_ready' });
  });

  it('propagates a ShareObject right refusal', async () => {
    const client = clientStub({
      shareArtifact: async () => {
        throw new NextoreClientError('nextore_http_error', 'no share right', 403, 'share_forbidden');
      },
    });
    const runtime = runtimeStub();
    const base = await startApp({ runtime, client });

    const response = await postJson(
      base,
      '/api/nextore/projects/project-1/artifacts/artifact-1/share',
      {},
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'share_forbidden' });
  });

  it('revokes the requested representation', async () => {
    const revokeArtifactShare = vi.fn(async () => ({ revoked: true }));
    const client = clientStub({ revokeArtifactShare });
    const runtime = runtimeStub();
    const base = await startApp({ runtime, client });

    const response = await fetch(
      base + '/api/nextore/projects/project-1/artifacts/artifact-1/share?representation=source',
      { method: 'DELETE' },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ representation: 'source', revoked: true });
    expect(revokeArtifactShare).toHaveBeenCalledWith('token-1', 'nc-77', 'artifact-1', 'source');
  });

  it('shares the project folder through NexTore', async () => {
    const client = clientStub({});
    const runtime = runtimeStub();
    const base = await startApp({ runtime, client });

    const response = await postJson(base, '/api/nextore/projects/project-1/share', {});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: 'https://share.test/s/folder',
      scope: 'project',
      previewOnly: true,
    });
  });

  it('requires a NexTore session', async () => {
    const base = await startApp({ runtime: runtimeStub(), client: clientStub({}), withSession: false });

    const response = await postJson(
      base,
      '/api/nextore/projects/project-1/artifacts/artifact-1/share',
      {},
    );

    expect(response.status).toBe(401);
  });

  it('answers 404 when sharing is disabled', async () => {
    const base = await startApp({ runtime: null, client: null });

    const response = await postJson(
      base,
      '/api/nextore/projects/project-1/artifacts/artifact-1/share',
      {},
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'feature_disabled' });
  });
});
