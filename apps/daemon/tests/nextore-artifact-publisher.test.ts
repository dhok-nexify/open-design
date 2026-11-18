import Database from 'better-sqlite3';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateNextoreDatabase } from '../src/nextore/db.js';
import {
  getNextoreArtifact,
  upsertNextoreArtifact,
} from '../src/nextore/artifacts/store.js';
import {
  publishArtifactJob,
  type PublishArtifactJob,
} from '../src/nextore/artifacts/publisher.js';
import { NextoreClientError, type NextoreArtifactClient } from '../src/nextore/client.js';

let db: Database.Database;
let dir: string;
let filePath: string;

beforeEach(async () => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
  `);
  migrateNextoreDatabase(db);
  dir = await mkdtemp(join(tmpdir(), 'p04c-publisher-'));
  filePath = join(dir, 'index.html');
  await writeFile(filePath, '<html>one</html>', 'utf8');
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

function job(overrides: Partial<PublishArtifactJob> = {}): PublishArtifactJob {
  return {
    projectId: 'project-1',
    artifactId: 'artifact-1',
    representation: 'source',
    relativePath: 'index.html',
    name: 'index.html',
    mimeType: 'text/html',
    sourcePath: filePath,
    runId: 'run-1',
    tier: 'expert',
    memberId: 7,
    savedAt: '2026-11-18T00:00:00Z',
    ...overrides,
  };
}

function client(
  publishArtifact: (...args: unknown[]) => Promise<unknown>,
): Pick<NextoreArtifactClient, 'publishArtifact'> {
  return { publishArtifact } as unknown as Pick<NextoreArtifactClient, 'publishArtifact'>;
}

const result = {
  representation: 'source' as const,
  treeObjectId: 101,
  version: 1,
  versionLabel: '1',
  auditId: 'audit-1',
};

describe('publishArtifactJob', () => {
  it('publishes, stores the mapping, and records the content hash', async () => {
    const publish = vi.fn(async () => result);
    const outcome = await publishArtifactJob(job(), {
      db,
      client: client(publish),
      resolveAccessToken: async () => 'token-1',
      now: () => 1_000,
    });

    expect(outcome).toMatchObject({
      status: 'published',
      treeObjectId: 101,
      version: 1,
      retryable: false,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      treeObjectId: 101,
      currentVersion: 1,
      status: 'published',
      publishedAt: 1_000,
    });
  });

  it('publishes against the mapped NexTore project id, not the local one', async () => {
    const publish = vi.fn(async () => result);
    const outcome = await publishArtifactJob(job(), {
      db,
      client: client(publish),
      resolveAccessToken: async () => 'token-1',
      resolveNextoreProjectId: () => '4242',
      now: () => 1_000,
    });

    expect(outcome.status).toBe('published');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![1]).toBe('4242');
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      projectId: 'project-1',
      status: 'published',
    });
  });

  it('fails without publishing when the project has no NexTore mapping', async () => {
    const publish = vi.fn(async () => result);
    const outcome = await publishArtifactJob(job(), {
      db,
      client: client(publish),
      resolveAccessToken: async () => 'token-1',
      resolveNextoreProjectId: () => null,
      now: () => 1_000,
    });

    expect(outcome).toMatchObject({
      status: 'failed',
      errorCode: 'project_unmapped',
      retryable: false,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('skips the client when the stored hash already matches', async () => {
    const publish = vi.fn(async () => result);
    const deps = {
      db,
      client: client(publish),
      resolveAccessToken: async () => 'token-1',
      now: () => 1_000,
    };
    await publishArtifactJob(job(), deps);
    publish.mockClear();

    const second = await publishArtifactJob(job(), deps);
    expect(second.status).toBe('published');
    expect(second.treeObjectId).toBe(101);
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns publish_pending with auth_required when the member has no token', async () => {
    const publish = vi.fn(async () => result);
    const outcome = await publishArtifactJob(job(), {
      db,
      client: client(publish),
      resolveAccessToken: async () => null,
    });

    expect(outcome).toMatchObject({
      status: 'publish_pending',
      errorCode: 'auth_required',
      retryable: true,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('marks a 5xx as retryable publish_pending', async () => {
    const publish = vi.fn(async () => {
      throw new NextoreClientError('nextore_http_error', 'upstream down', 503, 'nextore_unavailable');
    });
    const outcome = await publishArtifactJob(job(), {
      db,
      client: client(publish),
      resolveAccessToken: async () => 'token-1',
    });

    expect(outcome).toMatchObject({
      status: 'publish_pending',
      errorCode: 'nextore_unavailable',
      retryable: true,
    });
  });

  it('marks versioning_required as failed and not retryable', async () => {
    const publish = vi.fn(async () => {
      throw new NextoreClientError('nextore_http_error', 'versioning disabled', 409, 'versioning_required');
    });
    const outcome = await publishArtifactJob(job(), {
      db,
      client: client(publish),
      resolveAccessToken: async () => 'token-1',
    });

    expect(outcome).toMatchObject({
      status: 'failed',
      errorCode: 'versioning_required',
      retryable: false,
    });
  });

  it('re-hashes and retries once on content_hash_mismatch', async () => {
    let calls = 0;
    const publish = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await writeFile(filePath, '<html>two</html>', 'utf8');
        throw new NextoreClientError('nextore_http_error', 'hash mismatch', 409, 'content_hash_mismatch');
      }
      return result;
    });

    const outcome = await publishArtifactJob(job(), {
      db,
      client: client(publish),
      resolveAccessToken: async () => 'token-1',
    });

    expect(outcome.status).toBe('published');
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('marks the mapping orphaned when the source file disappeared', async () => {
    upsertNextoreArtifact(db, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      treeObjectId: 101,
      currentVersion: 1,
      contentHash: 'old-hash',
      status: 'published',
      publishedAt: 1_000,
      updatedAt: 1_000,
    });
    await unlink(filePath);

    const outcome = await publishArtifactJob(job(), {
      db,
      client: client(vi.fn(async () => result)),
      resolveAccessToken: async () => 'token-1',
      now: () => 2_000,
    });

    expect(outcome.status).toBe('orphaned');
    expect(getNextoreArtifact(db, 'project-1', 'artifact-1', 'source')).toMatchObject({
      status: 'orphaned',
      orphanedAt: 2_000,
    });
  });
});
