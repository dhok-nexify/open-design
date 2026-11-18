import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateNextoreDatabase } from '../src/nextore/db.js';
import {
  enqueueNextorePublish,
  upsertNextoreArtifact,
} from '../src/nextore/artifacts/store.js';
import { buildNextoreArtifactStatus } from '../src/nextore/artifacts/status.js';
import {
  isNextoreArtifactPublishEnabled,
  isNextoreArtifactShareEnabled,
  resolveNextoreArtifactAuthorityMode,
} from '../src/nextore/artifacts/features.js';

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

describe('Nextore artifact authority flags', () => {
  it('resolves off, publish, and publish+share modes', () => {
    expect(resolveNextoreArtifactAuthorityMode({})).toBe('off');
    expect(resolveNextoreArtifactAuthorityMode({ NEXTORE_ARTIFACT_AUTHORITY: 'off' })).toBe('off');
    expect(resolveNextoreArtifactAuthorityMode({ NEXTORE_ARTIFACT_AUTHORITY: 'publish' })).toBe('publish');
    expect(resolveNextoreArtifactAuthorityMode({ NEXTORE_ARTIFACT_AUTHORITY: 'publish+share' })).toBe('publish+share');
  });

  it('fails closed on an unknown mode', () => {
    expect(resolveNextoreArtifactAuthorityMode({ NEXTORE_ARTIFACT_AUTHORITY: 'yes' })).toBe('off');
  });

  it('derives publish and share capability from the mode', () => {
    expect(isNextoreArtifactPublishEnabled('off')).toBe(false);
    expect(isNextoreArtifactPublishEnabled('publish')).toBe(true);
    expect(isNextoreArtifactPublishEnabled('publish+share')).toBe(true);
    expect(isNextoreArtifactShareEnabled('publish')).toBe(false);
    expect(isNextoreArtifactShareEnabled('publish+share')).toBe(true);
  });
});

describe('buildNextoreArtifactStatus', () => {
  it('aggregates each representation with its own queue state', () => {
    upsertNextoreArtifact(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      treeObjectId: 101,
      currentVersion: 3,
      contentHash: 'hash-source',
      status: 'published',
      publishedAt: 1_000,
      updatedAt: 1_000,
    });
    upsertNextoreArtifact(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'snapshot',
      relativePath: 'index.pdf',
      treeObjectId: 102,
      currentVersion: 2,
      contentHash: 'hash-snapshot',
      status: 'published',
      publishedAt: 1_000,
      updatedAt: 1_000,
    });
    enqueueNextorePublish(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'manual-retry',
      now: 1_000,
    });

    const status = buildNextoreArtifactStatus(db, 'project-1', 'artifact-1');

    expect(status.representations).toHaveLength(2);
    expect(status.representations.find((row) => row.representation === 'source')).toMatchObject({
      artifact: { currentVersion: 3 },
      queue: { pending: true, attempts: 0, nextAttemptAt: 1_000 },
      share: null,
    });
    expect(status.representations.find((row) => row.representation === 'snapshot')).toMatchObject({
      artifact: { currentVersion: 2 },
      queue: { pending: false, attempts: 0, nextAttemptAt: null },
      share: null,
    });
  });
});
