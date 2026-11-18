import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerNextoreArtifactRoutes } from '../src/nextore/artifacts/routes.js';
import type { NextoreArtifactRuntime } from '../src/nextore/artifacts/runtime.js';

function runtimeStub(
  retried: boolean,
  reconciled: Record<string, unknown> | null = { adopted: 0, requeued: 0, orphaned: 0, skipped: 0, unavailable: false },
): NextoreArtifactRuntime {
  return {
    status: vi.fn(() => ({ projectId: 'project-1', artifactId: 'artifact-1', representations: [] })),
    retry: vi.fn(() => retried),
    reconcileProject: vi.fn(async () => reconciled),
  } as unknown as NextoreArtifactRuntime;
}

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

async function startApp(options: {
  retried: boolean;
  deny?: boolean;
  runtime?: NextoreArtifactRuntime | null;
}): Promise<string> {
  const app = express();
  app.use(express.json());
  registerNextoreArtifactRoutes(app, {
    runtime: options.runtime === undefined ? runtimeStub(options.retried) : options.runtime,
    authorizeProject: async (_req, res) => {
      if (options.deny) {
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

describe('nextore artifact retry route', () => {
  it('re-arms the representation and answers 202', async () => {
    const runtime = runtimeStub(true);
    const base = await startApp({ retried: true, runtime });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/artifact-1/retry?representation=snapshot`,
      { method: 'POST' },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'snapshot',
      retried: true,
    });
    expect(runtime.retry).toHaveBeenCalledWith('project-1', 'artifact-1', 'snapshot');
  });

  it('defaults to the source representation', async () => {
    const runtime = runtimeStub(true);
    const base = await startApp({ retried: true, runtime });

    await fetch(`${base}/api/nextore/projects/project-1/artifacts/artifact-1/retry`, { method: 'POST' });

    expect(runtime.retry).toHaveBeenCalledWith('project-1', 'artifact-1', 'source');
  });

  it('answers 404 when no queue row exists', async () => {
    const base = await startApp({ retried: false });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/artifact-1/retry`,
      { method: 'POST' },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'nextore_queue_item_not_found' });
  });

  it('rejects an unknown representation', async () => {
    const runtime = runtimeStub(true);
    const base = await startApp({ retried: true, runtime });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/artifact-1/retry?representation=raw`,
      { method: 'POST' },
    );

    expect(response.status).toBe(400);
    expect(runtime.retry).not.toHaveBeenCalled();
  });

  it('does not retry when the authorizer denies the caller', async () => {
    const runtime = runtimeStub(true);
    const base = await startApp({ retried: true, runtime, deny: true });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/artifact-1/retry`,
      { method: 'POST' },
    );

    expect(response.status).toBe(403);
    expect(runtime.retry).not.toHaveBeenCalled();
  });

  it('returns the reconciliation summary', async () => {
    const runtime = runtimeStub(true, { adopted: 2, requeued: 1, orphaned: 0, skipped: 0, unavailable: false });
    const base = await startApp({ retried: true, runtime });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/reconcile`,
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId: 'project-1', adopted: 2, requeued: 1 });
  });

  it('answers 409 when reconciliation cannot run yet', async () => {
    const runtime = runtimeStub(true, null);
    const base = await startApp({ retried: true, runtime });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/reconcile`,
      { method: 'POST' },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'reconcile_unavailable' });
  });

  it('answers 404 when the artifact runtime is disabled', async () => {
    const base = await startApp({ retried: false, runtime: null });

    const response = await fetch(
      `${base}/api/nextore/projects/project-1/artifacts/artifact-1/retry`,
      { method: 'POST' },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'feature_disabled' });
  });
});
