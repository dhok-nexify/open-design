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
import { getNextoreArtifact, listNextorePublishQueue } from '../src/nextore/artifacts/store.js';
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
