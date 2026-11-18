import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateNextoreDatabase } from '../src/nextore/db.js';
import {
  enqueueNextorePublish,
  getNextoreArtifact,
  getNextorePublishQueueItem,
  listNextorePublishQueue,
  upsertNextoreArtifact,
} from '../src/nextore/artifacts/store.js';
import type { PublishArtifactJob, PublishOutcome } from '../src/nextore/artifacts/publisher.js';
import { runNextorePublishWorkerOnce } from '../src/nextore/artifacts/worker.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
  `);
  migrateNextoreDatabase(db);
});

afterEach(() => {
  db.close();
});

function enqueue(now = 1_000): string {
  return enqueueNextorePublish(db, {
    projectId: 'project-1',
    artifactId: 'artifact-1',
    representation: 'source',
    relativePath: 'index.html',
    reason: 'run-complete',
    now,
  }).id;
}

function job(): PublishArtifactJob {
  return {
    projectId: 'project-1',
    artifactId: 'artifact-1',
    representation: 'source',
    relativePath: 'index.html',
    name: 'index.html',
    mimeType: 'text/html',
    sourcePath: 'C:/tmp/index.html',
    runId: 'run-1',
    tier: 'expert',
    memberId: 7,
  };
}

function outcome(overrides: Partial<PublishOutcome> = {}): PublishOutcome {
  return {
    status: 'published',
    version: 1,
    treeObjectId: 101,
    errorCode: null,
    message: null,
    retryable: false,
    contentHash: 'hash-1',
    ...overrides,
  };
}

describe('runNextorePublishWorkerOnce', () => {
  it('completes a published item', async () => {
    const id = enqueue();
    const tick = await runNextorePublishWorkerOnce({
      db,
      workerId: 'worker-a',
      resolveJob: async () => job(),
      publish: async () => outcome(),
      now: () => 1_000,
    });

    expect(tick.claimed?.id).toBe(id);
    expect(tick.outcome?.status).toBe('published');
    expect(listNextorePublishQueue(db)).toHaveLength(0);
  });

  it('completes a non-retryable failure without retrying', async () => {
    const id = enqueue();
    const tick = await runNextorePublishWorkerOnce({
      db,
      workerId: 'worker-a',
      resolveJob: async () => job(),
      publish: async () => outcome({
        status: 'failed',
        version: null,
        treeObjectId: null,
        errorCode: 'versioning_required',
        message: 'versioning disabled',
      }),
      now: () => 1_000,
    });

    expect(tick.outcome?.status).toBe('failed');
    expect(listNextorePublishQueue(db)).toHaveLength(0);
    expect(getNextorePublishQueueItem(db, id)).toBeNull();
  });

  it('schedules a retry with backoff', async () => {
    const id = enqueue();
    await runNextorePublishWorkerOnce({
      db,
      workerId: 'worker-a',
      resolveJob: async () => job(),
      publish: async () => outcome({
        status: 'publish_pending',
        version: null,
        treeObjectId: null,
        errorCode: 'nextore_unavailable',
        message: 'down',
        retryable: true,
      }),
      now: () => 1_000,
    });

    expect(getNextorePublishQueueItem(db, id)).toMatchObject({
      attempts: 1,
      nextAttemptAt: 6_000,
      claimedBy: null,
    });
  });

  it('dead-letters at the attempt limit and marks the mapping failed', async () => {
    const id = enqueue();
    upsertNextoreArtifact(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      treeObjectId: 101,
      currentVersion: 1,
      contentHash: 'hash-1',
      status: 'publish_pending',
      publishedAt: 1_000,
      updatedAt: 1_000,
    });

    await runNextorePublishWorkerOnce({
      db,
      workerId: 'worker-a',
      resolveJob: async () => job(),
      publish: async () => outcome({
        status: 'publish_pending',
        version: null,
        treeObjectId: null,
        errorCode: 'nextore_unavailable',
        message: 'down',
        retryable: true,
      }),
      now: () => 1_000,
      maxAttempts: 1,
    });

    expect(getNextorePublishQueueItem(db, id)).toMatchObject({
      deadLetteredAt: 1_000,
      claimedBy: null,
    });
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      status: 'failed',
      lastError: 'dead_letter:nextore_unavailable',
    });
  });

  it('drops an item whose job cannot be resolved', async () => {
    enqueue();
    const tick = await runNextorePublishWorkerOnce({
      db,
      workerId: 'worker-a',
      resolveJob: async () => null,
      publish: async () => outcome(),
      now: () => 1_000,
    });

    expect(tick.outcome).toBeNull();
    expect(listNextorePublishQueue(db)).toHaveLength(0);
  });

  it('turns an unexpected publisher exception into a retry', async () => {
    const id = enqueue();
    await runNextorePublishWorkerOnce({
      db,
      workerId: 'worker-a',
      resolveJob: async () => job(),
      publish: vi.fn(async () => {
        throw new Error('boom');
      }),
      now: () => 1_000,
    });

    expect(getNextorePublishQueueItem(db, id)).toMatchObject({
      attempts: 1,
      nextAttemptAt: 6_000,
      lastError: 'boom',
    });
  });
});
