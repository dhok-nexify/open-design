import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextoreArtifactClient } from '../src/nextore/client.js';
import type { NextoreConfig } from '../src/nextore/config.js';
import type {
  NewNextoreSession,
  NextoreSession,
  NextoreSessionMember,
  NextoreSessionStore,
  TokenUpdate,
} from '../src/nextore/auth/session-store.js';
import { migrateNextoreDatabase } from '../src/nextore/db.js';
import {
  getNextoreArtifact,
  listNextorePublishQueue,
  upsertNextoreArtifact,
} from '../src/nextore/artifacts/store.js';
import { NextoreArtifactRuntime, type NextoreArtifactStatusEvent } from '../src/nextore/artifacts/runtime.js';

const config: NextoreConfig = {
  baseUrl: 'http://nextore.test',
  oauthClientId: 'client',
  designerBaseUrl: 'http://designer.test',
  secretFile: '/run/secrets/designer',
  trustProxy: null,
};

const member: NextoreSessionMember = {
  id: 7,
  login: 'alice',
  fullName: 'Alice',
  email: 'alice@example.test',
  language: 'en',
  profileObjectId: 1,
};

class FakeSessionStore implements NextoreSessionStore {
  rows = new Map<string, NextoreSession>();

  create(_session: NewNextoreSession): NextoreSession {
    throw new Error('not implemented');
  }
  find(sid: string): NextoreSession | null { return this.rows.get(sid) ?? null; }
  touch(sid: string, seenAt: number): void {
    const row = this.rows.get(sid);
    if (row) this.rows.set(sid, { ...row, lastSeenAt: seenAt });
  }
  updateTokens(sid: string, update: TokenUpdate): void {
    const row = this.rows.get(sid);
    if (!row) return;
    this.rows.set(sid, { ...row, accessToken: update.accessToken, refreshToken: update.refreshToken, tokenExpiresAt: update.tokenExpiresAt });
  }
  recordValidation(sid: string, validatedAt: number, nextMember: NextoreSessionMember): void {
    const row = this.rows.get(sid);
    if (row) this.rows.set(sid, { ...row, member: nextMember, lastValidatedAt: validatedAt });
  }
  remove(sid: string): void { this.rows.delete(sid); }
  pruneExpired(_before: number): number { return 0; }
  listByMember(memberId: number): NextoreSession[] {
    return [...this.rows.values()].filter((row) => row.memberId === memberId);
  }
}

let db: Database.Database;
let dir: string;
let projectRoot: string;

beforeEach(async () => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
  `);
  migrateNextoreDatabase(db);
  dir = await mkdtemp(join(tmpdir(), 'p04c-runtime-'));
  projectRoot = dir;
  await writeFile(join(projectRoot, 'index.html'), '<html></html>', 'utf8');
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

function runtime(
  mode: 'off' | 'publish' | 'publish+share',
  onStatus?: (event: NextoreArtifactStatusEvent) => void,
): { runtime: NextoreArtifactRuntime; publish: ReturnType<typeof vi.fn>; store: FakeSessionStore } {
  const store = new FakeSessionStore();
  store.rows.set('sid-1', {
    sid: 'sid-1',
    memberId: 7,
    member,
    accessToken: 'token-1',
    refreshToken: null,
    tokenExpiresAt: 2_000_000,
    createdAt: 1_000,
    lastSeenAt: 1_000,
    lastValidatedAt: 1_000,
  });
  const publish = vi.fn(async () => ({
    representation: 'source' as const,
    treeObjectId: 101,
    version: 1,
    versionLabel: '1',
    auditId: 'audit-1',
  }));
  const client = { publishArtifact: publish } as unknown as NextoreArtifactClient;
  return {
    runtime: new NextoreArtifactRuntime({
      db,
      client,
      sessionStore: store,
      config,
      mode,
      now: () => 1_000,
      autoDrain: false,
      ...(onStatus ? { onStatus } : {}),
    }),
    publish,
    store,
  };
}

const deliverable = {
  valid: true,
  entryFile: 'index.html',
  artifactKind: 'html',
  linkedPage: null,
};

describe('NextoreArtifactRuntime', () => {
  it('remembers the run initiator across a restart so reconcile still runs', async () => {
    const first = runtime('publish');
    first.runtime.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: null,
      memberId: 7,
      deliverable,
    });
    first.runtime.stop();

    // Same database, new process: the in-memory map starts empty, so only the
    // persisted row can make this reconcile possible.
    const store = new FakeSessionStore();
    store.rows.set('sid-1', {
      sid: 'sid-1',
      memberId: 7,
      member,
      accessToken: 'token-1',
      refreshToken: null,
      tokenExpiresAt: 2_000_000,
      createdAt: 1_000,
      lastSeenAt: 1_000,
      lastValidatedAt: 1_000,
    });
    const listArtifacts = vi.fn(async () => []);
    const restarted = new NextoreArtifactRuntime({
      db,
      client: { listArtifacts } as unknown as NextoreArtifactClient,
      sessionStore: store,
      config,
      mode: 'publish',
      now: () => 1_000,
      autoDrain: false,
      readProjectMapping: () => '286756',
      resolveProjectRoot: () => projectRoot,
    });

    const result = await restarted.reconcileProject('project-1');

    expect(result).not.toBeNull();
    expect(listArtifacts).toHaveBeenCalledTimes(1);
  });


  it('enqueues a finalized run with the full durable payload', () => {
    const { runtime: worker } = runtime('publish');
    const count = worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
    });

    expect(count).toBe(1);
    expect(listNextorePublishQueue(db, 'project-1')[0]).toMatchObject({
      memberId: 7,
      runId: 'run-1',
      tier: 'expert',
      sourcePath: join(projectRoot, 'index.html'),
      name: 'index.html',
      mimeType: 'text/html',
    });
  });

  it('re-arms an existing queue row and refuses an unknown one', () => {
    const { runtime: worker } = runtime('publish');
    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
    });

    expect(worker.retry('project-1', 'artifact-1', 'source')).toBe(true);
    expect(worker.retry('project-1', 'artifact-1', 'snapshot')).toBe(false);
  });

  it('does not re-arm a queue row in off mode', () => {
    const { runtime: worker } = runtime('off');
    expect(worker.retry('project-1', 'artifact-1', 'source')).toBe(false);
  });

  it('does not enqueue in off mode', () => {
    const { runtime: worker } = runtime('off');
    expect(worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
    })).toBe(0);
    expect(listNextorePublishQueue(db)).toHaveLength(0);
  });

  it('drains a queued run and emits a published status event', async () => {
    const events: NextoreArtifactStatusEvent[] = [];
    const { runtime: worker, publish } = runtime('publish', (event) => events.push(event));
    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
    });
    const processed = await worker.drainOnce();

    expect(processed).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      status: 'published',
      treeObjectId: 101,
      currentVersion: 1,
    });
    expect(events[0]).toMatchObject({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      status: 'published',
      version: 1,
      error: null,
    });
  });

  it('exposes status through the mapping and queue tables', () => {
    const { runtime: worker } = runtime('publish');
    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
    });

    const status = worker.status('project-1', 'artifact-1');
    expect(status.representations).toHaveLength(0);
    expect(listNextorePublishQueue(db, 'project-1')).toHaveLength(1);
  });
});

describe('NextoreArtifactRuntime reconciliation sweep', () => {
  it('reconciles a bounded round-robin slice per sweep', async () => {
    const store = new FakeSessionStore();
    store.rows.set('sid-1', {
      sid: 'sid-1',
      memberId: 7,
      member,
      accessToken: 'token-1',
      refreshToken: null,
      tokenExpiresAt: 2_000_000,
      createdAt: 1_000,
      lastSeenAt: 1_000,
      lastValidatedAt: 1_000,
    });
    const worker = new NextoreArtifactRuntime({
      db,
      client: { publishArtifact: vi.fn() } as unknown as NextoreArtifactClient,
      sessionStore: store,
      config,
      mode: 'publish',
      autoDrain: false,
      reconcileBatchSize: 2,
      reconcileSpacingMs: 0,
    });
    for (const projectId of ['p1', 'p2', 'p3']) {
      worker.enqueueRun({
        projectId,
        artifactId: 'artifact-1',
        projectRoot,
        runId: 'run-1',
        tier: null,
        memberId: 7,
        deliverable,
      });
    }
    const spy = vi.spyOn(worker, 'reconcileProject').mockResolvedValue(null);

    const first = await worker.reconcileSweepOnce();
    const second = await worker.reconcileSweepOnce();
    const third = await worker.reconcileSweepOnce();

    expect(first).toBe(2);
    expect(second).toBe(2);
    expect(third).toBe(2);
    expect(spy.mock.calls.map((call) => call[0])).toEqual([
      'p1', 'p2',
      'p3', 'p1',
      'p2', 'p3',
    ]);
  });

  it('does nothing when no project has published yet', async () => {
    const store = new FakeSessionStore();
    const worker = new NextoreArtifactRuntime({
      db,
      client: { publishArtifact: vi.fn() } as unknown as NextoreArtifactClient,
      sessionStore: store,
      config,
      mode: 'publish',
      autoDrain: false,
    });
    expect(await worker.reconcileSweepOnce()).toBe(0);
  });
});

describe('NextoreArtifactRuntime out-of-run trigger', () => {
  function watchedRuntime(options: {
    deliverable?: { valid: boolean; entryFile: string | null; artifactKind: string | null; linkedPage: string | null };
  } = {}) {
    const store = new FakeSessionStore();
    store.rows.set('sid-1', {
      sid: 'sid-1',
      memberId: 7,
      member,
      accessToken: 'token-1',
      refreshToken: null,
      tokenExpiresAt: 2_000_000,
      createdAt: 1_000,
      lastSeenAt: 1_000,
      lastValidatedAt: 1_000,
    });
    const publish = vi.fn(async () => ({
      representation: 'source' as const,
      treeObjectId: 101,
      version: 1,
      versionLabel: '1',
      auditId: 'audit-1',
    }));
    let onChange: (() => void) | null = null;
    const dispose = vi.fn();
    const worker = new NextoreArtifactRuntime({
      db,
      client: { publishArtifact: publish } as unknown as NextoreArtifactClient,
      sessionStore: store,
      config,
      mode: 'publish',
      now: () => 1_000,
      autoDrain: false,
      fileChangeDebounceMs: 20,
      watchProjectFiles: (_projectId, callback) => {
        onChange = callback;
        return dispose;
      },
      resolveProjectDeliverable: async () => ({
        deliverable: options.deliverable ?? {
          valid: true,
          entryFile: 'index.html',
          artifactKind: 'html',
          linkedPage: null,
        },
        projectRoot,
      }),
    });
    return {
      worker,
      publish,
      dispose,
      fire: () => onChange?.(),
    };
  }

  function seedPublishedRecord() {
    upsertNextoreArtifact(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      treeObjectId: 101,
      currentVersion: 1,
      contentHash: 'a'.repeat(64),
      status: 'published',
      publishedAt: 1_000,
      updatedAt: 1_000,
    });
  }

  it('re-enqueues the published entry after a debounced out-of-run edit', async () => {
    seedPublishedRecord();
    const { worker, fire, publish } = watchedRuntime();
    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
    });
    // Drop the run-complete row so only the file-change row can be observed.
    db.prepare('DELETE FROM nextore_publish_queue').run();

    fire();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(publish).not.toHaveBeenCalled();
    expect(listNextorePublishQueue(db, 'project-1')).toEqual([
      expect.objectContaining({
        artifactId: 'artifact-1',
        representation: 'source',
        reason: 'file-change',
        memberId: 7,
        runId: null,
      }),
    ]);
    worker.unwatchAll();
  });

  it('ignores an invalid project deliverable', async () => {
    seedPublishedRecord();
    const { worker, fire } = watchedRuntime({
      deliverable: { valid: false, entryFile: null, artifactKind: null, linkedPage: null },
    });
    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
    });
    db.prepare('DELETE FROM nextore_publish_queue').run();

    fire();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(listNextorePublishQueue(db, 'project-1')).toHaveLength(0);
    worker.unwatchAll();
  });

  it('only watches a project once and disposes every watcher on stop', () => {
    const { worker, dispose } = watchedRuntime();
    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
    });
    worker.watchProject('project-1');
    worker.stop();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
