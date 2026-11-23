import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type {
  NextoreArtifactPublishRequest,
  NextoreArtifactPublishResult,
  NextoreArtifactRepresentation,
  NextoreTier,
} from '@open-design/contracts';

import { NextoreClientError, type NextoreArtifactClient } from '../client.js';
import {
  getNextoreArtifact,
  markNextoreArtifactOrphaned,
  updateNextoreArtifactStatus,
  upsertNextoreArtifact,
} from './store.js';

type SqliteDb = Database.Database;

/** One publish attempt resolved from a durable queue item. */
export interface PublishArtifactJob {
  projectId: string;
  artifactId: string;
  representation: NextoreArtifactRepresentation;
  relativePath: string;
  name: string;
  mimeType: string;
  sourcePath: string;
  runId: string | null;
  tier: NextoreTier | null;
  memberId: number;
  savedAt?: string | null;
}

export type PublishOutcomeStatus = 'published' | 'publish_pending' | 'failed' | 'orphaned';

export interface PublishOutcome {
  status: PublishOutcomeStatus;
  version: number | null;
  treeObjectId: number | null;
  errorCode: string | null;
  message: string | null;
  retryable: boolean;
  contentHash: string | null;
}

export interface PublisherDeps {
  db: SqliteDb;
  client: Pick<NextoreArtifactClient, 'publishArtifact'>;
  /** Resolve a still-valid member token; null means the member must sign in again. */
  resolveAccessToken: (memberId: number) => Promise<string | null>;
  /**
   * Translate the local Designer project id to the NexTore project folder id.
   * The module's artifact routes are keyed by the NexTore id, so publishing with
   * the local id would target a folder that does not exist. Defaults to identity
   * for unit tests that use an already-mapped id.
   */
  resolveNextoreProjectId?: (projectId: string) => string | null;
  hashFile?: (path: string) => Promise<string>;
  now?: () => number;
}

const NON_RETRYABLE_CODES = new Set([
  'versioning_required',
  'artifact_hidden',
  'artifact_forbidden',
  'invalid_name',
  'invalid_mime',
  'invalid_representation',
  'artifact_too_large',
  'name_conflict',
  'name_conflict_foreign',
  'name_conflict_race',
  'designer_access_required',
  'project_not_found',
  'storage_profile_unavailable',
]);

export async function hashFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

function pending(errorCode: string, message: string, contentHash: string | null = null): PublishOutcome {
  return {
    status: 'publish_pending',
    version: null,
    treeObjectId: null,
    errorCode,
    message,
    retryable: true,
    contentHash,
  };
}

function failed(errorCode: string, message: string, contentHash: string | null = null): PublishOutcome {
  return {
    status: 'failed',
    version: null,
    treeObjectId: null,
    errorCode,
    message,
    retryable: false,
    contentHash,
  };
}

function published(
  treeObjectId: number,
  version: number,
  contentHash: string,
): PublishOutcome {
  return {
    status: 'published',
    version,
    treeObjectId,
    errorCode: null,
    message: null,
    retryable: false,
    contentHash,
  };
}

function idempotencyKey(job: PublishArtifactJob, contentHash: string): string {
  return `${job.projectId}:${job.artifactId}:${job.representation}:${contentHash}`;
}

function recordOutcome(
  db: SqliteDb,
  job: PublishArtifactJob,
  outcome: PublishOutcome,
  at: number,
): void {
  if (outcome.status === 'published' || outcome.status === 'orphaned') return;
  updateNextoreArtifactStatus(db, {
    projectId: job.projectId,
    artifactId: job.artifactId,
    representation: job.representation,
    status: outcome.status,
    lastError: outcome.errorCode,
    updatedAt: at,
  });
}

function classifyClientError(error: NextoreClientError): PublishOutcome {
  if (error.code === 'nextore_timeout' || error.code === 'nextore_unreachable') {
    return pending(error.code, error.message);
  }
  if (error.code === 'nextore_http_error') {
    const upstream = error.upstreamCode ?? '';
    const statusCode = error.statusCode;
    if (NON_RETRYABLE_CODES.has(upstream)) return failed(upstream, error.message);
    if (upstream === 'auth_required' || statusCode === 401) {
      return pending('auth_required', error.message);
    }
    if (statusCode === 403) return failed('artifact_forbidden', error.message);
    if (typeof statusCode === 'number' && statusCode >= 500) {
      return pending('nextore_unavailable', error.message);
    }
  }
  return failed(error.upstreamCode ?? 'publish_failed', error.message);
}

/**
 * Publish one representation once. The caller decides retry/backoff; this function only performs
 * the attempt and returns a stable outcome. File content is always re-hashed immediately before
 * upload, so a queue item cannot publish a stale hash.
 */
export async function publishArtifactJob(
  job: PublishArtifactJob,
  deps: PublisherDeps,
): Promise<PublishOutcome> {
  const now = deps.now ?? Date.now;
  const hashFile = deps.hashFile ?? hashFileSha256;

  const token = await deps.resolveAccessToken(job.memberId);
  if (!token) {
    const outcome = pending('auth_required', 'The member must sign in again.');
    recordOutcome(deps.db, job, outcome, now());
    return outcome;
  }
  const accessToken = token;

  const resolveNextoreProjectId = deps.resolveNextoreProjectId ?? ((projectId: string) => projectId);
  const nextoreProjectId = resolveNextoreProjectId(job.projectId);
  if (!nextoreProjectId) {
    const outcome = failed('project_unmapped', 'The project is not linked to a NexTore project.');
    recordOutcome(deps.db, job, outcome, now());
    return outcome;
  }
  const targetProjectId: string = nextoreProjectId;

  try {
    await stat(job.sourcePath);
  } catch {
    markNextoreArtifactOrphaned(
      deps.db, job.projectId, job.artifactId, job.representation, now());
    return {
      status: 'orphaned',
      version: null,
      treeObjectId: null,
      errorCode: 'artifact_missing',
      message: 'The source artifact no longer exists.',
      retryable: false,
      contentHash: null,
    };
  }

  let contentHash = await hashFile(job.sourcePath);
  const existing = getNextoreArtifact(
    deps.db, job.projectId, job.artifactId, job.representation);
  // A rename moves the file without changing a byte. Only content AND path
  // matching is a true no-op; otherwise the module must hear about the new name
  // or the published copy keeps the old one forever.
  if (
    existing
    && existing.contentHash === contentHash
    && existing.relativePath === job.relativePath
  ) {
    return published(existing.treeObjectId, existing.currentVersion, contentHash);
  }

  async function attempt(hash: string): Promise<PublishOutcome> {
    const metadata: NextoreArtifactPublishRequest = {
      representation: job.representation,
      relativePath: job.relativePath,
      name: job.name,
      mimeType: job.mimeType,
      contentHash: hash,
      idempotencyKey: idempotencyKey(job, hash),
      runId: job.runId,
      tier: job.tier,
      savedAt: job.savedAt ?? null,
    };

    try {
      const result = await deps.client.publishArtifact<NextoreArtifactPublishResult>(
        accessToken,
        targetProjectId,
        job.artifactId,
        metadata,
        { path: job.sourcePath, name: job.name, mimeType: job.mimeType },
      );
      const at = now();
      upsertNextoreArtifact(deps.db, {
        projectId: job.projectId,
        artifactId: job.artifactId,
        representation: job.representation,
        relativePath: job.relativePath,
        treeObjectId: result.treeObjectId,
        currentVersion: result.version,
        contentHash: hash,
        status: 'published',
        publishedAt: at,
        lastError: null,
        orphanedAt: null,
        updatedAt: at,
      });
      return published(result.treeObjectId, result.version, hash);
    } catch (error) {
      if (!(error instanceof NextoreClientError)) {
        return failed(
          'publish_failed',
          error instanceof Error ? error.message : 'Artifact publish failed.',
          hash,
        );
      }
      if (error.upstreamCode === 'content_hash_mismatch') {
        const latest = await hashFile(job.sourcePath);
        if (latest !== hash) return attempt(latest);
        return failed('content_hash_mismatch', error.message, hash);
      }
      return classifyClientError(error);
    }
  }

  const outcome = await attempt(contentHash);
  recordOutcome(deps.db, job, outcome, now());
  return outcome;
}
