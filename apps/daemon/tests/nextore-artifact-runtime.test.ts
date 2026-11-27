import Database from 'better-sqlite3';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
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
  enqueueNextorePublish,
  getNextoreArtifact,
  listNextorePublishQueue,
  rememberProjectMember,
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
  options: { releaseZipDir?: string } = {},
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
      resolveProjectRoot: () => projectRoot,
      ...(options.releaseZipDir ? { releaseZipDir: options.releaseZipDir } : {}),
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


  it('reconciles from the publish queue when the member table is still empty', async () => {
    // An existing deployment has queue rows but no nextore_project_members row
    // yet, which is exactly the state a first rollout finds.
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
    db.prepare('DELETE FROM nextore_project_members').run();

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

  it('reconciles as the operator when the publisher has no live session', async () => {
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

    // Only the operator (member 9) has a session; the publisher (7) does not.
    const store = new FakeSessionStore();
    store.rows.set('sid-9', {
      sid: 'sid-9',
      memberId: 9,
      member: { ...member, id: 9, login: 'operator', fullName: 'Operator' },
      accessToken: 'token-9',
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

    const result = await restarted.reconcileProject('project-1', 9);

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

  it('records a frozen Release for the run and reuses it on an identical retry', () => {
    const { runtime: worker } = runtime('publish');
    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
      exportedFiles: ['chapters/one.html', 'assets/site.css', 'assets/app.js'],
    });

    const first = worker.releases('project-1');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      version: 1,
      status: 'partial',
      runId: 'run-1',
    });
    expect(first[0]?.files.map((file) => file.relativePath)).toEqual([
      'index.html',
      'chapters/one.html',
      'assets/site.css',
      'assets/app.js',
    ]);

    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
      exportedFiles: ['chapters/one.html', 'assets/site.css', 'assets/app.js'],
    });
    expect(worker.releases('project-1')).toHaveLength(1);
  });

  it('freezes and publishes a deterministic zip as a single-file artifact', async () => {
    await mkdir(join(projectRoot, 'chapters'), { recursive: true });
    await mkdir(join(projectRoot, 'assets'), { recursive: true });
    await writeFile(join(projectRoot, 'chapters', 'one.html'), '<html>one</html>', 'utf8');
    await writeFile(join(projectRoot, 'assets', 'site.css'), 'body{}', 'utf8');
    const zipDir = join(dir, 'release-zips');
    const { runtime: worker } = runtime('publish', undefined, { releaseZipDir: zipDir });
    worker.enqueueRun({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      projectRoot,
      runId: 'run-1',
      tier: 'expert',
      memberId: 7,
      deliverable,
      exportedFiles: ['chapters/one.html', 'assets/site.css'],
    });

    for (let i = 0; i < 5; i += 1) await worker.drainOnce();

    const release = worker.releases('project-1')[0]!;
    expect(release.status).toBe('ready');
    const zip = await worker.releaseZip('project-1', release.releaseId);
    expect(zip).not.toBeNull();
    const archive = await JSZip.loadAsync(zip!.buffer);
    expect(archive.file('manifest.json')).not.toBeNull();
    expect(archive.file('assets/site.css')).not.toBeNull();

    // Same manifest must produce identical bytes.
    const again = await worker.releaseZip('project-1', release.releaseId);
    expect(again?.sha256).toBe(zip?.sha256);
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
    expect(worker.releases('project-1')[0]?.status).toBe('ready');
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
    resolveFallbackMember?: (projectId: string) => Promise<number | null>;
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
    let onChange: ((changed: ReadonlyArray<{
      path: string;
      kind: 'add' | 'change' | 'unlink';
    }>) => void) | null = null;
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
      resolveProjectRoot: () => projectRoot,
      resolveProjectDeliverable: async () => ({
        deliverable: options.deliverable ?? {
          valid: true,
          entryFile: 'index.html',
          artifactKind: 'html',
          linkedPage: null,
        },
        projectRoot,
      }),
      ...(options.resolveFallbackMember
        ? { resolveFallbackMember: options.resolveFallbackMember }
        : {}),
    });
    return {
      worker,
      publish,
      dispose,
      fire: (changed: ReadonlyArray<{ path: string; kind: 'add' | 'change' | 'unlink' }> = []) =>
        onChange?.(changed),
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

  it('adopts an HTML page that first appears with no artifact row', async () => {
    // An upload lands on disk with no artifact row, so the entry-file path
    // would drop it. The watcher batch names the file, and adoption publishes
    // it under its own project-relative id.
    seedPublishedRecord();
    rememberProjectMember(db, 'project-1', 7, 1_000);
    await writeFile(join(projectRoot, 'uploaded-page.html'), '<!doctype html><h1>uploaded</h1>');
    const { worker, fire } = watchedRuntime();
    worker.watchProject('project-1');

    fire([{ path: 'uploaded-page.html', kind: 'add' }]);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(listNextorePublishQueue(db, 'project-1')).toEqual([
      expect.objectContaining({
        artifactId: 'uploaded-page.html',
        representation: 'source',
        relativePath: 'uploaded-page.html',
        reason: 'file-adopted',
        memberId: 7,
      }),
    ]);
    worker.unwatchAll();
  });

  it('adopts generated static assets and skips hidden files', async () => {
    seedPublishedRecord();
    rememberProjectMember(db, 'project-1', 7, 1_000);
    await writeFile(join(projectRoot, 'site.css'), 'body{}');
    await writeFile(join(projectRoot, '.od-state.json'), '{}');
    const { worker, fire } = watchedRuntime();
    worker.watchProject('project-1');

    fire([
      { path: 'site.css', kind: 'add' },
      { path: '.od-state.json', kind: 'add' },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(listNextorePublishQueue(db, 'project-1')).toEqual([
      expect.objectContaining({
        artifactId: 'site.css',
        relativePath: 'site.css',
        mimeType: 'text/css',
        reason: 'file-adopted',
      }),
    ]);
    worker.unwatchAll();
  });

  it('restores out-of-run watchers for projects known only from the database', async () => {
    // A restart clears the in-memory watcher map and the run history. The
    // durable artifact row plus the remembered member must be enough to keep
    // republishing edits made before the next run.
    seedPublishedRecord();
    rememberProjectMember(db, 'project-1', 7, 1_000);
    const { worker, fire, publish } = watchedRuntime();

    expect(worker.restoreWatchers()).toBe(1);

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

  it('publishes as a borrowed editor when no publisher was ever recorded', async () => {
    seedPublishedRecord();
    // Legacy project: artifact rows exist, the member table does not.
    const fallback = vi.fn(async () => 7);
    const { worker, fire } = watchedRuntime({ resolveFallbackMember: fallback });

    expect(worker.restoreWatchers()).toBe(1);
    fire();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(fallback).toHaveBeenCalledWith('project-1');
    expect(listNextorePublishQueue(db, 'project-1')).toEqual([
      expect.objectContaining({ reason: 'file-change', memberId: 7 }),
    ]);
    worker.unwatchAll();
  });

  it('drops the change with a reason when no member may edit the project', async () => {
    seedPublishedRecord();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { worker, fire } = watchedRuntime({ resolveFallbackMember: async () => null });

    expect(worker.restoreWatchers()).toBe(1);
    fire();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(listNextorePublishQueue(db, 'project-1')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no signed-in member may edit'));
    warn.mockRestore();
    worker.unwatchAll();
  });

  it('starts watching a project that publishes without a run', async () => {
    seedPublishedRecord();
    rememberProjectMember(db, 'project-1', 7, 1_000);
    const { worker, fire, publish } = watchedRuntime();
    // Simulate a reconcile/adoption publish: a queued job with no enqueueRun.
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      memberId: 7,
      runId: null,
      tier: null,
      relativePath: 'index.html',
      sourcePath: join(projectRoot, 'index.html'),
      name: 'index.html',
      mimeType: 'text/html',
      reason: 'reconcile',
      now: 1_000,
    });

    await worker.drainOnce();
    expect(publish).toHaveBeenCalledTimes(1);

    fire();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(listNextorePublishQueue(db, 'project-1')).toEqual([
      expect.objectContaining({ reason: 'file-change', memberId: 7 }),
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
