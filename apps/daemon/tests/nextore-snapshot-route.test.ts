import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NextoreArtifactRecord } from '@open-design/contracts';

import { SnapshotRenderError } from '../src/nextore/artifacts/snapshot-renderer.js';
import {
  createSnapshotLimiter,
  registerNextoreSnapshotRoutes,
} from '../src/nextore/artifacts/snapshot-routes.js';
import type { NextoreArtifactRuntime } from '../src/nextore/artifacts/runtime.js';

let server: Server | null = null;
let root: string | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (root) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    root = null;
  }
});

function sourceRecord(overrides: Partial<NextoreArtifactRecord> = {}): NextoreArtifactRecord {
  return {
    projectId: 'project-1',
    artifactId: 'blog-post.html',
    representation: 'source',
    relativePath: 'blog-post.html',
    treeObjectId: 292707,
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

async function startApp(options: {
  record?: NextoreArtifactRecord | null;
  render?: () => Promise<{ path: string; bytes: number; workDir: string }>;
  deny?: boolean;
  maxConcurrent?: number;
  queueLimit?: number;
} = {}): Promise<{ base: string; queueSnapshot: ReturnType<typeof vi.fn> }> {
  root = await mkdtemp(join(tmpdir(), 'od-snapshot-route-'));
  await writeFile(join(root, 'blog-post.html'), '<html>qa</html>', 'utf8');

  const queueSnapshot = vi.fn();
  const runtime = {
    artifactRecord: vi.fn(() => (options.record === undefined ? sourceRecord() : options.record)),
    projectRoot: vi.fn(() => root),
    queueSnapshot,
  } as unknown as NextoreArtifactRuntime;

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.nextoreSession = { memberId: 7 };
    next();
  });
  registerNextoreSnapshotRoutes(app, {
    runtime,
    authorizeProject: async (_req, res) => {
      if (options.deny) {
        res.status(403).json({ error: 'forbidden' });
        return false;
      }
      return true;
    },
    ...(options.maxConcurrent !== undefined ? { maxConcurrent: options.maxConcurrent } : {}),
    ...(options.queueLimit !== undefined ? { queueLimit: options.queueLimit } : {}),
    render: options.render ?? (async () => {
      const workDir = await mkdtemp(join(tmpdir(), 'od-snapshot-out-'));
      const path = join(workDir, 'snapshot.pdf');
      await writeFile(path, '%PDF-1.7 test', 'latin1');
      return { path, bytes: 14, workDir };
    }),
  });

  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { base: 'http://127.0.0.1:' + port, queueSnapshot };
}

function post(base: string): Promise<globalThis.Response> {
  return fetch(base + '/api/nextore/projects/project-1/artifacts/blog-post.html/snapshot', {
    method: 'POST',
  });
}

describe('snapshot concurrency limiter', () => {
  it('runs one render at a time and releases the next slot', async () => {
    const limiter = createSnapshotLimiter(1, 2);
    const order: string[] = [];
    let release: (() => void) | null = null;

    const first = limiter.run(async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => { release = resolve; });
      order.push('first:end');
    });
    const second = limiter.run(async () => {
      order.push('second:start');
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['first:start']);
    expect(limiter.waiting()).toBe(1);

    release!();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('rejects with the busy error once the queue is full', async () => {
    const limiter = createSnapshotLimiter(1, 0);
    let release: (() => void) | null = null;
    const running = limiter.run(() => new Promise<void>((resolve) => { release = resolve; }));

    await expect(limiter.run(async () => {})).rejects.toMatchObject({ name: 'SnapshotBusyError' });
    release!();
    await running;
  });
});

describe('nextore snapshot route', () => {
  it('renders the source and queues a snapshot publish', async () => {
    const { base, queueSnapshot } = await startApp();

    const response = await post(base);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      projectId: 'project-1',
      artifactId: 'blog-post.html',
      representation: 'snapshot',
      queued: true,
    });
    expect(queueSnapshot).toHaveBeenCalledTimes(1);
    const queued = queueSnapshot.mock.calls[0]![0] as { relativePath: string; mimeType: string; sourcePath: string };
    expect(queued.relativePath).toBe('.od-snapshots/blog-post.pdf');
    expect(queued.mimeType).toBe('application/pdf');
    await expect(readFile(queued.sourcePath)).resolves.toBeInstanceOf(Buffer);
  });

  it('refuses when the source representation is not published', async () => {
    const { base, queueSnapshot } = await startApp({
      record: sourceRecord({ status: 'publish_pending' }),
    });

    const response = await post(base);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'snapshot_source_not_ready' });
    expect(queueSnapshot).not.toHaveBeenCalled();
  });

  it('answers 501 when the host has no Chromium', async () => {
    const { base, queueSnapshot } = await startApp({
      render: async () => {
        throw new SnapshotRenderError('chromium_missing', 'No Chromium binary was found.');
      },
    });

    const response = await post(base);

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ error: 'chromium_missing' });
    expect(queueSnapshot).not.toHaveBeenCalled();
  });

  it('answers 429 when the render queue is full', async () => {
    let release: (() => void) | null = null;
    const { base } = await startApp({
      maxConcurrent: 1,
      queueLimit: 0,
      render: () => new Promise((resolve) => {
        release = () => resolve({ path: join(root!, 'blocked.pdf'), bytes: 0, workDir: join(root!, 'blocked') });
      }),
    });

    const first = post(base);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await post(base);

    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ error: 'snapshot_busy' });

    release!();
    await first;
  });

  it('stops at the project authorizer', async () => {
    const { base, queueSnapshot } = await startApp({ deny: true });

    const response = await post(base);

    expect(response.status).toBe(403);
    expect(queueSnapshot).not.toHaveBeenCalled();
  });
});
