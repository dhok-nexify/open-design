import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateNextoreDatabase } from '../src/nextore/db.js';
import { enqueueNextorePublish, listNextorePublishQueue } from '../src/nextore/artifacts/store.js';
import type { PublishArtifactJob, PublishOutcome } from '../src/nextore/artifacts/publisher.js';
import { drainNextorePublishQueue } from '../src/nextore/artifacts/worker.js';

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

function job(projectId: string, artifactId: string): PublishArtifactJob {
  return {
    projectId,
    artifactId,
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

describe('drainNextorePublishQueue', () => {
  it('processes due items sequentially', async () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });
    enqueueNextorePublish(db, {
      projectId: 'project-2',
      artifactId: 'artifact-2',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });

    const result = await drainNextorePublishQueue({
      db,
      workerId: 'worker-a',
      resolveJob: async (item) => job(item.projectId, item.artifactId),
      publish: async () => outcome(),
      now: () => 1_000,
    });

    expect(result.processed).toBe(2);
    expect(listNextorePublishQueue(db)).toHaveLength(0);
  });

  it('stops when the only item was rescheduled for a later retry', async () => {
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      now: 1_000,
    });

    const result = await drainNextorePublishQueue({
      db,
      workerId: 'worker-a',
      resolveJob: async (item) => job(item.projectId, item.artifactId),
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

    expect(result.processed).toBe(1);
    expect(listNextorePublishQueue(db)).toHaveLength(1);
  });
});
