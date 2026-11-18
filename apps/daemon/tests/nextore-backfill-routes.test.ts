import Database from 'better-sqlite3';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateNextoreDatabase } from '../src/nextore/db.js';
import { registerNextoreBackfillRoutes } from '../src/nextore/artifacts/backfill-routes.js';
import type { NextoreArtifactRuntime } from '../src/nextore/artifacts/runtime.js';

let db: Database.Database;
let server: Server | null = null;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
  `);
  migrateNextoreDatabase(db);
});

afterEach(async () => {
  if (server) {
    const current = server;
    server = null;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
  db.close();
});

function runtimeStub(): NextoreArtifactRuntime {
  return {
    reconcileProject: vi.fn(async () => ({
      adopted: 0, requeued: 0, orphaned: 0, skipped: 0, unavailable: false,
    })),
  } as unknown as NextoreArtifactRuntime;
}

async function startApp(options: {
  runtime?: NextoreArtifactRuntime | null;
  withSession?: boolean;
  projectIds?: string[];
} = {}): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    if (options.withSession !== false) res.locals.nextoreSession = { memberId: 7 };
    next();
  });
  registerNextoreBackfillRoutes(app, {
    runtime: options.runtime === undefined ? runtimeStub() : options.runtime,
    db,
    listProjectIds: () => options.projectIds ?? ['p1', 'p2'],
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function post(base: string, body: unknown): Promise<globalThis.Response> {
  return fetch(base + '/api/nextore/artifacts/backfill', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('nextore backfill routes', () => {
  it('reports empty progress before any batch runs', async () => {
    const base = await startApp();

    const response = await fetch(base + '/api/nextore/artifacts/backfill');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ paused: false, total: 0, pending: 0 });
  });

  it('runs one bounded batch and reports progress', async () => {
    const runtime = runtimeStub();
    const base = await startApp({ runtime });

    const response = await post(base, { action: 'start', batchSize: 2 });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      action: 'start',
      ran: 2,
      done: 2,
      skipped: false,
      progress: { total: 2, done: 2, pending: 0 },
    });
    expect(runtime.reconcileProject).toHaveBeenCalledTimes(2);
  });

  it('pauses and resumes the rollout', async () => {
    const base = await startApp();

    const paused = await post(base, { action: 'pause' });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ paused: true });

    const started = await post(base, { action: 'start', batchSize: 2 });
    expect(await started.json()).toMatchObject({ ran: 2, skipped: false });

    const resumed = await post(base, { action: 'resume' });
    expect(await resumed.json()).toMatchObject({ paused: false });
  });

  it('rejects an unknown action', async () => {
    const base = await startApp();

    const response = await post(base, { action: 'explode' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_action' });
  });

  it('requires a NexTore session', async () => {
    const base = await startApp({ withSession: false });

    const response = await fetch(base + '/api/nextore/artifacts/backfill');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'SESSION_REQUIRED' });
  });

  it('answers 404 when the artifact runtime is disabled', async () => {
    const base = await startApp({ runtime: null });

    const response = await fetch(base + '/api/nextore/artifacts/backfill');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'feature_disabled' });
  });
});
