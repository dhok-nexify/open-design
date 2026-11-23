import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateNextoreDatabase } from '../src/nextore/db.js';
import {
  claimNextNextorePublish,
  completeNextorePublish,
  enqueueNextorePublish,
  failNextorePublish,
  getNextoreArtifact,
  getNextorePublishQueueItem,
  listNextoreArtifacts,
  listNextorePublishQueue,
  listProjectMembers,
  markNextoreArtifactOrphaned,
  nextorePublishQueueId,
  retryNextorePublish,
  updateNextoreArtifactStatus,
  upsertNextoreArtifact,
  type UpsertNextoreArtifactInput,
} from '../src/nextore/artifacts/store.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
  `);
  migrateNextoreDatabase(db);
});

afterEach(() => {
  db.close();
});

function artifact(
  overrides: Partial<UpsertNextoreArtifactInput> = {},
): UpsertNextoreArtifactInput {
  return {
    projectId: 'project-1',
    artifactId: 'artifact-1',
    representation: 'source',
    relativePath: 'index.html',
    treeObjectId: 101,
    currentVersion: 1,
    contentHash: 'hash-1',
    status: 'published',
    publishedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function tableNames(): string[] {
  return (db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

describe('nextore artifact store schema', () => {
  it('creates the artifact and queue tables through the edition migration', () => {
    expect(tableNames()).toEqual(expect.arrayContaining([
      'nextore_artifacts',
      'nextore_publish_queue',
      'nextore_schema_migrations',
    ]));
  });

  it('keeps the schema idempotent', () => {
    expect(() => migrateNextoreDatabase(db)).not.toThrow();
  });
});

describe('nextore artifact mapping', () => {
  it('keeps source and snapshot side by side without overwriting each other', () => {
    upsertNextoreArtifact(db, artifact());
    upsertNextoreArtifact(db, artifact({
      representation: 'snapshot',
      relativePath: 'index.snapshot.pdf',
      treeObjectId: 102,
      contentHash: 'hash-snapshot',
      updatedAt: 2_000,
    }));

    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      representation: 'source',
      relativePath: 'index.html',
      treeObjectId: 101,
    });
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'snapshot')).toMatchObject({
      representation: 'snapshot',
      relativePath: 'index.snapshot.pdf',
      treeObjectId: 102,
    });

    upsertNextoreArtifact(db, artifact({
      relativePath: 'landing.html',
      updatedAt: 3_000,
    }));

    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      relativePath: 'landing.html',
      updatedAt: 3_000,
    });
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'snapshot')).toMatchObject({
      relativePath: 'index.snapshot.pdf',
      updatedAt: 2_000,
    });
    expect(listNextoreArtifacts(db, 'project-1', 'artifact-1')).toHaveLength(2);
  });

  it('rejects a second artifact representation mapped to the same TreeObject', () => {
    upsertNextoreArtifact(db, artifact());
    expect(() => upsertNextoreArtifact(db, artifact({
      artifactId: 'artifact-2',
      relativePath: 'second.html',
    }))).toThrow();
  });

  it('updates status and marks one representation orphaned', () => {
    upsertNextoreArtifact(db, artifact());

    expect(updateNextoreArtifactStatus(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      status: 'failed',
      lastError: 'nexTore unavailable',
      updatedAt: 2_000,
    })).toBe(true);

    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      status: 'failed',
      lastError: 'nexTore unavailable',
      updatedAt: 2_000,
    });

    expect(markNextoreArtifactOrphaned(db, 'project-1', 'artifact-1', 'source', 3_000))
      .toBe(true);
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      status: 'orphaned',
      orphanedAt: 3_000,
      updatedAt: 3_000,
    });
  });

  it('returns null for an unknown representation', () => {
    upsertNextoreArtifact(db, artifact());
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'cover')).toBeNull();
  });
});

describe('nextore publish queue', () => {
  it('uses a distinct queue key for each representation', () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'snapshot',
      relativePath: 'index.snapshot.pdf',
      reason: 'run-complete',
      now: 1_000,
    });

    const queue = listNextorePublishQueue(db, 'project-1');
    expect(queue).toHaveLength(2);
    expect(new Set(queue.map((item) => item.id)).size).toBe(2);
    expect(queue.map((item) => item.representation).sort()).toEqual(['snapshot', 'source']);
    expect(queue.map((item) => item.id)).toEqual(expect.arrayContaining([
      nextorePublishQueueId('project-1', 'artifact-1', 'source'),
      nextorePublishQueueId('project-1', 'artifact-1', 'snapshot'),
    ]));
  });

  it('enqueues one job per representation and keeps the earliest due time', () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'landing.html',
      reason: 'manual-retry',
      now: 1_500,
    });

    const queue = listNextorePublishQueue(db, 'project-1', 'source');
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: nextorePublishQueueId('project-1', 'artifact-1', 'source'),
      representation: 'source',
      relativePath: 'landing.html',
      reason: 'manual-retry',
      nextAttemptAt: 1_000,
      attempts: 0,
      claimedBy: null,
      deadLetteredAt: null,
    });
  });

  it('claims a due job once across workers and completes it', () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });

    const first = claimNextNextorePublish(db, { workerId: 'worker-a', now: 1_000, leaseMs: 50 });
    expect(first).toMatchObject({ representation: 'source', claimedBy: 'worker-a', attempts: 1 });
    expect(claimNextNextorePublish(db, { workerId: 'worker-b', now: 1_000, leaseMs: 50 }))
      .toBeNull();

    expect(completeNextorePublish(db, first!.id, 'worker-a')).toBe(true);
    expect(listNextorePublishQueue(db)).toHaveLength(0);
  });

  it('returns no job before it is due or while a lease is active', () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });

    expect(claimNextNextorePublish(db, { workerId: 'worker-a', now: 999 })).toBeNull();
    const first = claimNextNextorePublish(db, { workerId: 'worker-a', now: 1_000, leaseMs: 50 });
    expect(first).not.toBeNull();
    expect(claimNextNextorePublish(db, { workerId: 'worker-b', now: 1_049, leaseMs: 50 }))
      .toBeNull();
  });

  it('reclaims an expired lease', () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });

    expect(claimNextNextorePublish(db, { workerId: 'worker-a', now: 1_000, leaseMs: 50 }))
      .not.toBeNull();
    const second = claimNextNextorePublish(db, { workerId: 'worker-b', now: 1_050, leaseMs: 50 });
    expect(second).toMatchObject({ claimedBy: 'worker-b', attempts: 2 });
  });

  it('schedules a retry and dead-letters on the next failure', () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });

    const first = claimNextNextorePublish(db, { workerId: 'worker-a', now: 1_000, leaseMs: 50 })!;
    expect(failNextorePublish(db, {
      id: first.id,
      workerId: 'worker-a',
      error: 'nexTore unavailable',
      retryAt: 2_000,
    })).toBe(true);
    expect(claimNextNextorePublish(db, { workerId: 'worker-b', now: 1_999 })).toBeNull();

    const second = claimNextNextorePublish(db, { workerId: 'worker-b', now: 2_000, leaseMs: 50 })!;
    expect(second).toMatchObject({ attempts: 2, lastError: 'nexTore unavailable' });
    expect(failNextorePublish(db, {
      id: second.id,
      workerId: 'worker-b',
      error: 'permanent failure',
      deadLetter: true,
      now: 2_500,
    })).toBe(true);

    const dead = getNextorePublishQueueItem(db, second.id);
    expect(dead).toMatchObject({
      deadLetteredAt: 2_500,
      lastError: 'permanent failure',
      claimedBy: null,
    });
    expect(claimNextNextorePublish(db, { workerId: 'worker-c', now: 3_000 })).toBeNull();
  });

  it('resets a dead-lettered job through an explicit retry', () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });
    const first = claimNextNextorePublish(db, { workerId: 'worker-a', now: 1_000, leaseMs: 50 })!;
    failNextorePublish(db, {
      id: first.id,
      workerId: 'worker-a',
      error: 'permanent failure',
      deadLetter: true,
      now: 1_500,
    });

    expect(retryNextorePublish(db, 'project-1', 'artifact-1', 'source', 4_000)).toBe(true);
    expect(getNextorePublishQueueItem(db, first.id)).toMatchObject({
      representation: 'source',
      attempts: 0,
      nextAttemptAt: 4_000,
      deadLetteredAt: null,
      lastError: null,
      claimedBy: null,
    });
    expect(claimNextNextorePublish(db, { workerId: 'worker-b', now: 4_000 }))
      .toMatchObject({ claimedBy: 'worker-b', attempts: 1 });
  });
});

describe('nextore artifact representation migration', () => {
  it('preserves old rows as source and rewrites the queue key once', () => {
    const legacy = new Database(':memory:');
    legacy.pragma('foreign_keys = ON');
    try {
      legacy.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY);
        CREATE TABLE messages (id TEXT PRIMARY KEY);

        CREATE TABLE nextore_artifacts (
          project_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          tree_object_id INTEGER NOT NULL,
          current_version INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          published_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          last_error TEXT,
          orphaned_at INTEGER,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (project_id, artifact_id)
        );

        CREATE TABLE nextore_publish_queue (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          reason TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          claimed_by TEXT,
          lease_until INTEGER,
          dead_letter_at INTEGER,
          last_error TEXT
        );

        INSERT INTO nextore_artifacts (
          project_id, artifact_id, relative_path, tree_object_id, current_version,
          content_hash, published_at, status, last_error, orphaned_at, updated_at
        ) VALUES (
          'project-1', 'artifact-1', 'index.html', 101, 1,
          'hash-1', 1000, 'published', NULL, NULL, 1000
        );

        INSERT INTO nextore_publish_queue (
          id, project_id, artifact_id, relative_path, reason, attempts,
          next_attempt_at, created_at, claimed_by, lease_until, dead_letter_at, last_error
        ) VALUES (
          'project-1::artifact-1', 'project-1', 'artifact-1', 'index.html',
          'run-complete', 0, 1000, 1000, NULL, NULL, NULL, NULL
        );
      `);

      migrateNextoreDatabase(legacy);

      expect(getNextoreArtifact(legacy, 'project-1', 'artifact-1', 'source')).toMatchObject({
        representation: 'source',
        relativePath: 'index.html',
        treeObjectId: 101,
        currentVersion: 1,
      });
      const queue = listNextorePublishQueue(legacy, 'project-1');
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        id: 'project-1::artifact-1::source',
        representation: 'source',
        relativePath: 'index.html',
      });

      expect(() => migrateNextoreDatabase(legacy)).not.toThrow();
      expect(listNextorePublishQueue(legacy, 'project-1')).toHaveLength(1);
    } finally {
      legacy.close();
    }
  });
});

describe('publisher identity', () => {
  it('records the member who publishes on every enqueue path', () => {
    // Snapshot and reconcile publishes have no run to remember them; without
    // this row a restart cannot answer "whose session publishes this project".
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'index.html',
      representation: 'snapshot',
      memberId: 9,
      relativePath: '.od-snapshots/index.pdf',
      reason: 'snapshot',
      now: 1_000,
    });

    expect(listProjectMembers(db)).toEqual([{ projectId: 'project-1', memberId: 9 }]);
  });

  it('leaves the recorded member alone when a job carries none', () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'index.html',
      representation: 'snapshot',
      memberId: 9,
      relativePath: '.od-snapshots/index.pdf',
      reason: 'snapshot',
      now: 1_000,
    });
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'index.html',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'file-change',
      now: 2_000,
    });

    expect(listProjectMembers(db)).toEqual([{ projectId: 'project-1', memberId: 9 }]);
  });
});
