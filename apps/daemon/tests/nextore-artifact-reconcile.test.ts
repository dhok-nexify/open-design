import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateNextoreDatabase } from '../src/nextore/db.js';
import type { NextoreArtifactClient } from '../src/nextore/client.js';
import { NextoreClientError } from '../src/nextore/client.js';
import {
  getNextoreArtifact,
  listNextorePublishQueue,
  upsertNextoreArtifact,
} from '../src/nextore/artifacts/store.js';
import {
  normalizeRemoteArtifacts,
  reconcileProjectArtifacts,
} from '../src/nextore/artifacts/reconcile.js';

let db: Database.Database;
let projectRoot: string;

beforeEach(async () => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
  `);
  migrateNextoreDatabase(db);
  projectRoot = await mkdtemp(join(tmpdir(), 'p04c-reconcile-'));
  await writeFile(join(projectRoot, 'index.html'), '<html></html>', 'utf8');
});

afterEach(async () => {
  db.close();
  await rm(projectRoot, { recursive: true, force: true });
});

function client(listArtifacts: (...args: unknown[]) => Promise<unknown>): Pick<NextoreArtifactClient, 'listArtifacts'> {
  return { listArtifacts } as unknown as Pick<NextoreArtifactClient, 'listArtifacts'>;
}

function localRow(overrides: {
  contentHash?: string;
  currentVersion?: number;
  updatedAt?: number;
} = {}) {
  return upsertNextoreArtifact(db, {
    projectId: 'project-1',
    artifactId: 'artifact-1',
    representation: 'source',
    relativePath: 'index.html',
    treeObjectId: 101,
    currentVersion: overrides.currentVersion ?? 2,
    contentHash: overrides.contentHash ?? 'a'.repeat(64),
    status: 'published',
    publishedAt: 1_000,
    updatedAt: overrides.updatedAt ?? 1_000,
  });
}

const remoteRow = {
  artifactId: 'artifact-1',
  representation: 'source',
  treeObjectId: 101,
  version: 2,
  contentHash: 'a'.repeat(64),
  name: 'index.html',
  status: 'published',
};

function reconcile(
  listArtifacts: (...args: unknown[]) => Promise<unknown>,
  now = 2_000_000,
  missingGraceMs = 24 * 60 * 60 * 1000,
) {
  return reconcileProjectArtifacts({
    db,
    client: client(listArtifacts),
    projectId: 'project-1',
    nextoreProjectId: '4242',
    accessToken: 'token-1',
    projectRoot,
    memberId: 7,
    now: () => now,
    missingGraceMs,
  });
}

describe('reconcileProjectArtifacts', () => {
  it('confirms a matching row and does not queue anything', async () => {
    localRow();

    const result = await reconcile(async () => [remoteRow]);

    expect(result).toMatchObject({ adopted: 0, requeued: 0, orphaned: 0, unavailable: false });
    expect(listNextorePublishQueue(db, 'project-1')).toHaveLength(0);
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      status: 'published',
      currentVersion: 2,
      updatedAt: 2_000_000,
    });
  });

  it('adopts a module row whose file exists locally', async () => {
    const result = await reconcile(async () => [remoteRow]);

    expect(result.adopted).toBe(1);
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      treeObjectId: 101,
      currentVersion: 2,
      relativePath: 'index.html',
      status: 'published',
    });
  });

  it('skips a module row whose file is unknown locally', async () => {
    const result = await reconcile(async () => [
      { ...remoteRow, artifactId: 'artifact-2', name: 'missing.html' },
    ]);

    expect(result).toMatchObject({ adopted: 0, skipped: 1 });
    expect(getNextoreArtifact(db, 'project-1', 'artifact-2', 'source')).toBeNull();
  });

  it('queues a repair when the module version moved ahead', async () => {
    localRow({ currentVersion: 2 });

    const result = await reconcile(async () => [{ ...remoteRow, version: 3 }]);

    expect(result.requeued).toBe(1);
    expect(listNextorePublishQueue(db, 'project-1')[0]).toMatchObject({
      artifactId: 'artifact-1',
      representation: 'source',
      reason: 'reconcile',
      memberId: 7,
    });
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      status: 'publish_pending',
      lastError: 'reconcile_drift',
    });
  });

  it('queues a repair when the module hash differs', async () => {
    localRow();

    const result = await reconcile(async () => [{ ...remoteRow, contentHash: 'b'.repeat(64) }]);

    expect(result.requeued).toBe(1);
    expect(listNextorePublishQueue(db, 'project-1')).toHaveLength(1);
  });

  it('keeps a missing row inside the grace window', async () => {
    localRow({ updatedAt: 2_000_000 - 1_000 });

    const result = await reconcile(async () => [], 2_000_000, 60_000);

    expect(result.orphaned).toBe(0);
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')?.orphanedAt).toBeNull();
  });

  it('orphans a row the module has omitted past the grace window', async () => {
    localRow({ updatedAt: 0 });

    const result = await reconcile(async () => [], 2_000_000, 60_000);

    expect(result.orphaned).toBe(1);
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')?.orphanedAt).toBe(2_000_000);
  });

  it('changes nothing when the module is unreachable', async () => {
    localRow({ updatedAt: 0 });

    const result = await reconcile(async () => {
      throw new NextoreClientError('nextore_unreachable', 'offline');
    });

    expect(result).toMatchObject({ unavailable: true, orphaned: 0, requeued: 0 });
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')?.orphanedAt).toBeNull();
  });
});

describe('normalizeRemoteArtifacts', () => {
  it('accepts a bare array and a wrapped payload', () => {
    expect(normalizeRemoteArtifacts([remoteRow])).toHaveLength(1);
    expect(normalizeRemoteArtifacts({ artifacts: [remoteRow] })).toHaveLength(1);
  });

  it('ignores rows without a known representation or ids', () => {
    expect(normalizeRemoteArtifacts([
      { ...remoteRow, representation: 'raw' },
      { ...remoteRow, artifactId: '' },
      null,
    ])).toEqual([]);
  });

  it('reads PascalCase payloads', () => {
    expect(normalizeRemoteArtifacts([{
      ArtifactId: 'artifact-1',
      Representation: 'source',
      TreeObjectId: 101,
      Version: 2,
      ContentHash: 'a'.repeat(64),
      Name: 'index.html',
      Status: 'published',
    }])).toEqual([remoteRow]);
  });
});
