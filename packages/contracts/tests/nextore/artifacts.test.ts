import { describe, expect, it } from 'vitest';
import {
  NEXTORE_ARTIFACT_ERROR_CODES,
  NEXTORE_ARTIFACT_REPRESENTATIONS,
  NEXTORE_ARTIFACT_SHARE_REPRESENTATIONS,
  NEXTORE_ARTIFACT_STATUSES,
  isNextoreArtifactErrorCode,
  isNextoreArtifactRepresentation,
  isNextoreArtifactShareRepresentation,
  isNextoreArtifactStatus,
  type NextoreArtifactPublishRequest,
  type NextoreArtifactRecord,
  type NextoreArtifactStatusResponse,
  type NextorePublishQueueItem,
} from '../../src/nextore/artifacts.js';

describe('nextore artifact status', () => {
  it('accepts every declared status', () => {
    for (const status of NEXTORE_ARTIFACT_STATUSES) {
      expect(isNextoreArtifactStatus(status)).toBe(true);
    }
  });

  it('rejects unknown, empty, and non-string values', () => {
    expect(isNextoreArtifactStatus('done')).toBe(false);
    expect(isNextoreArtifactStatus('')).toBe(false);
    expect(isNextoreArtifactStatus(null)).toBe(false);
    expect(isNextoreArtifactStatus(1)).toBe(false);
  });

  it('keeps the declared status list free of duplicates', () => {
    expect(new Set(NEXTORE_ARTIFACT_STATUSES).size).toBe(NEXTORE_ARTIFACT_STATUSES.length);
  });
});

describe('nextore artifact representation', () => {
  it('accepts source, snapshot, and cover', () => {
    for (const representation of NEXTORE_ARTIFACT_REPRESENTATIONS) {
      expect(isNextoreArtifactRepresentation(representation)).toBe(true);
    }
  });

  it('rejects any other representation', () => {
    expect(isNextoreArtifactRepresentation('preview')).toBe(false);
    expect(isNextoreArtifactRepresentation(undefined)).toBe(false);
  });

  it('keeps share representations a subset that excludes cover', () => {
    for (const representation of NEXTORE_ARTIFACT_SHARE_REPRESENTATIONS) {
      expect(NEXTORE_ARTIFACT_REPRESENTATIONS).toContain(representation);
    }
    expect(isNextoreArtifactShareRepresentation('cover')).toBe(false);
  });

  it('keeps the declared representation list free of duplicates', () => {
    expect(new Set(NEXTORE_ARTIFACT_REPRESENTATIONS).size)
      .toBe(NEXTORE_ARTIFACT_REPRESENTATIONS.length);
  });
});

describe('nextore artifact DTOs', () => {
  it('requires representation on records, publish requests, queue items, and status', () => {
    const record = {
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
      orphanedAt: null,
      lastError: null,
    } satisfies NextoreArtifactRecord;

    const publishRequest = {
      representation: 'snapshot',
      relativePath: 'index.snapshot.pdf',
      contentHash: 'hash-2',
      idempotencyKey: 'project-1:artifact-1:snapshot:hash-2',
    } satisfies NextoreArtifactPublishRequest;

    const queueItem = {
      id: 'project-1::artifact-1::source',
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      reason: 'run-complete',
      attempts: 0,
      nextAttemptAt: 1_000,
      createdAt: 1_000,
      claimedBy: null,
      leaseUntil: null,
      deadLetteredAt: null,
      lastError: null,
    } satisfies NextorePublishQueueItem;

    const status = {
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representations: [{
        representation: 'source',
        artifact: record,
        queue: {
          pending: false,
          attempts: 0,
          nextAttemptAt: null,
          deadLettered: false,
          lastError: null,
        },
        share: null,
      }],
    } satisfies NextoreArtifactStatusResponse;

    expect(record.representation).toBe('source');
    expect(publishRequest.representation).toBe('snapshot');
    expect(queueItem.representation).toBe('source');
    expect(status.representations[0]?.representation).toBe('source');
  });
});

describe('nextore artifact error codes', () => {
  it('carries the stable codes the daemon and module map to', () => {
    expect(NEXTORE_ARTIFACT_ERROR_CODES).toEqual(expect.arrayContaining([
      'invalid_representation',
      'artifact_hidden',
      'name_conflict_race',
      'storage_profile_unavailable',
      'content_hash_mismatch',
      'versioning_required',
      'snapshot_renderer_unavailable',
      'folder_share_forbidden',
      'share_domain_unconfigured',
      'idempotency_conflict',
    ]));
  });

  it('accepts declared codes and rejects unknown ones', () => {
    for (const code of NEXTORE_ARTIFACT_ERROR_CODES) {
      expect(isNextoreArtifactErrorCode(code)).toBe(true);
    }
    expect(isNextoreArtifactErrorCode('not_a_code')).toBe(false);
  });

  it('keeps the declared error list free of duplicates', () => {
    expect(new Set(NEXTORE_ARTIFACT_ERROR_CODES).size).toBe(NEXTORE_ARTIFACT_ERROR_CODES.length);
  });
});
